import { Injectable, Logger } from '@nestjs/common';
import { Prisma, NotificationDelivery } from '@prisma/client';
import type { NotificationDeliveryListItem } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPreferencesService } from '../notification-preferences.service';
import { WebhookConfigService } from '../webhook-config.service';
import { NotificationTemplateRenderer } from './template-renderer';
import { ChannelAdapterRegistry, type OutboundMessage } from './channel-adapter';

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export interface DeliveryConfig {
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
  jitterMs: number;
}
export interface DeliveryBatchResult { claimed: number; sent: number; failed: number; deadLettered: number; skipped: number }

/**
 * Outbound delivery dispatcher (ADR 0011 §8) — the same reliability shape as the outbox relay, but at the
 * channel level: claim (SKIP LOCKED) + lease, per-delivery retry with backoff, dead-letter. A failed email
 * never blocks other deliveries, never touches the in-app notification, and never touches the domain outbox.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger('NotificationDelivery');
  config: DeliveryConfig = {
    batchSize: num(process.env.NOTIF_DELIVERY_BATCH_SIZE, 20),
    leaseMs: num(process.env.NOTIF_DELIVERY_LEASE_MS, 30_000),
    maxAttempts: num(process.env.NOTIF_DELIVERY_MAX_ATTEMPTS, 6),
    baseRetryMs: num(process.env.NOTIF_DELIVERY_BASE_RETRY_MS, 1_000),
    maxRetryMs: num(process.env.NOTIF_DELIVERY_MAX_RETRY_MS, 300_000),
    jitterMs: num(process.env.NOTIF_DELIVERY_JITTER_MS, 250),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    private readonly webhook: WebhookConfigService,
    private readonly renderer: NotificationTemplateRenderer,
    private readonly adapters: ChannelAdapterRegistry,
  ) {}

  async dispatchPending(opts: { organizationId?: string } = {}): Promise<DeliveryBatchResult> {
    const claimed = await this.claim(new Date(), opts.organizationId);
    const result: DeliveryBatchResult = { claimed: claimed.length, sent: 0, failed: 0, deadLettered: 0, skipped: 0 };
    for (const d of claimed) result[await this.deliver(d)] += 1;
    return result;
  }

  private async claim(now: Date, organizationId?: string): Promise<NotificationDelivery[]> {
    const orgClause = organizationId ? Prisma.sql`AND organization_id = ${organizationId}::uuid` : Prisma.empty;
    return this.prisma.$transaction(async (tx) => {
      // Compare against the DATABASE clock (now()) to avoid client/DB clock-skew under-claiming.
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM notification_deliveries
        WHERE ( (status IN ('PENDING', 'FAILED') AND available_at <= now())
             OR (status = 'PROCESSING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= now()) )
        ${orgClause}
        ORDER BY available_at ASC
        LIMIT ${this.config.batchSize}
        FOR UPDATE SKIP LOCKED`);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx.notificationDelivery.updateMany({ where: { id: { in: ids } }, data: { status: 'PROCESSING', leaseExpiresAt: new Date(now.getTime() + this.config.leaseMs) } });
      return tx.notificationDelivery.findMany({ where: { id: { in: ids } } });
    });
  }

  private async deliver(delivery: NotificationDelivery): Promise<'sent' | 'failed' | 'deadLettered' | 'skipped'> {
    const attempt = delivery.attemptCount + 1;
    await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { attemptCount: attempt } });

    const notification = await this.prisma.notification.findUnique({ where: { id: delivery.notificationId } });
    if (!notification) return this.markSkipped(delivery.id, 'notification no longer exists');
    const adapter = this.adapters.adapterFor(delivery.channel);
    if (!adapter) return this.fail(delivery.id, attempt, `no adapter for channel ${delivery.channel}`);

    // Build the channel message, re-checking eligibility at send time (a queued delivery may become
    // non-sendable — a disabled member, a revoked preference, a disabled webhook).
    let message: OutboundMessage;
    if (delivery.channel === 'EMAIL') {
      if (!delivery.notificationRecipientId) return this.markSkipped(delivery.id, 'email delivery has no recipient');
      const recipient = await this.prisma.notificationRecipient.findUnique({ where: { id: delivery.notificationRecipientId } });
      if (!recipient) return this.markSkipped(delivery.id, 'recipient no longer exists');
      const active = await this.prisma.membership.findFirst({ where: { organizationId: notification.organizationId, userId: recipient.userId, status: 'ACTIVE' }, select: { id: true } });
      if (!active) return this.markSkipped(delivery.id, 'recipient is no longer an active member');
      if (!(await this.preferences.isEnabled(recipient.userId, notification.type, 'EMAIL'))) return this.markSkipped(delivery.id, 'channel preference disabled');
      const user = await this.prisma.user.findUnique({ where: { id: recipient.userId }, select: { email: true } });
      if (!user) return this.markSkipped(delivery.id, 'recipient user not found');
      message = this.renderer.renderEmail(notification, user.email);
    } else {
      // WEBHOOK — org-level; re-check the org config is enabled and still subscribed to this type.
      const config = await this.webhook.activeConfig(notification.organizationId);
      if (!config) return this.markSkipped(delivery.id, 'webhook integration disabled');
      if (!(await this.webhook.isSubscribed(notification.organizationId, notification.type))) return this.markSkipped(delivery.id, 'webhook not subscribed to this type');
      message = this.renderer.renderWebhook(notification, delivery.id, config.url, config.signingSecret);
    }

    try {
      const { providerMessageId } = await adapter.send(message);
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date(), leaseExpiresAt: null, lastError: null, providerMessageId: providerMessageId ?? null },
      });
      return 'sent';
    } catch (err) {
      return this.fail(delivery.id, attempt, err instanceof Error ? err.message : String(err));
    }
  }

  private async markSkipped(id: string, reason: string): Promise<'skipped'> {
    await this.prisma.notificationDelivery.update({ where: { id }, data: { status: 'SKIPPED', leaseExpiresAt: null, lastError: reason.slice(0, 500) } });
    return 'skipped';
  }

  private async fail(id: string, attempt: number, error: string): Promise<'failed' | 'deadLettered'> {
    const lastError = error.slice(0, 500);
    if (attempt >= this.config.maxAttempts) {
      await this.prisma.notificationDelivery.update({ where: { id }, data: { status: 'DEAD_LETTER', deadLetteredAt: new Date(), leaseExpiresAt: null, lastError } });
      this.logger.warn(`delivery ${id} dead-lettered after ${attempt} attempt(s)`);
      return 'deadLettered';
    }
    const backoff = Math.min(this.config.baseRetryMs * 2 ** (attempt - 1), this.config.maxRetryMs) + Math.floor(Math.random() * this.config.jitterMs);
    await this.prisma.notificationDelivery.update({ where: { id }, data: { status: 'FAILED', availableAt: new Date(Date.now() + backoff), leaseExpiresAt: null, lastError } });
    return 'failed';
  }

  async recentDeliveries(organizationId: string, limit = 50): Promise<NotificationDeliveryListItem[]> {
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { organizationId },
      include: { notification: { select: { type: true } }, recipient: { select: { userId: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      attemptCount: d.attemptCount,
      notificationType: d.notification.type,
      recipientUserId: d.recipient?.userId ?? null,
      availableAt: d.availableAt.toISOString(),
      sentAt: d.sentAt ? d.sentAt.toISOString() : null,
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
    }));
  }
}
