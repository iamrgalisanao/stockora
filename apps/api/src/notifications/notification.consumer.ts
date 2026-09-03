import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsumerRegistry } from '../outbox/consumer-registry.service';
import type { DomainEventConsumer, DomainEventEnvelope } from '../outbox/consumer';
import { NotificationRuleEngine } from './notification-rules.service';
import { NotificationPreferencesService } from './notification-preferences.service';

/**
 * Outbox consumer that turns delivered domain facts into user-facing notifications (ADR 0011). Idempotent:
 * the relay's per-consumer receipt is the first guard; UNIQUE(eventId, ruleKey) is the backstop, so a replay
 * or multi-consumer retry never duplicates a notification. Creates the notification + all recipient rows in
 * one transaction. No external channel side effects.
 */
@Injectable()
export class NotificationConsumer implements DomainEventConsumer, OnModuleInit {
  readonly consumerName = 'notification-projection';
  readonly eventType = 'LotExpired';
  private static readonly TYPES = ['LotExpiringSoon', 'LotExpired', 'CycleCountCompleted'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConsumerRegistry,
    private readonly rules: NotificationRuleEngine,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  onModuleInit(): void {
    for (const eventType of NotificationConsumer.TYPES) {
      this.registry.register({ consumerName: this.consumerName, eventType, handle: (e) => this.handle(e) });
    }
  }

  async handle(event: DomainEventEnvelope): Promise<void> {
    const plan = await this.rules.plan(event);
    if (!plan || plan.recipientUserIds.length === 0) return; // no rule / no eligible recipients → nothing
    // Strict opt-in (ADR 0011 §9): queue an EMAIL delivery only for recipients who explicitly enabled it.
    const emailEnabled = await this.preferences.enabledUserIds(plan.recipientUserIds, plan.type, 'EMAIL');
    try {
      await this.prisma.$transaction(async (tx) => {
        const notification = await tx.notification.create({
          data: {
            organizationId: event.organizationId,
            eventId: event.id,
            ruleKey: plan.ruleKey,
            type: plan.type,
            title: plan.title,
            message: plan.message,
            severity: plan.severity,
            entityType: plan.entityType,
            entityId: plan.entityId,
            warehouseId: plan.warehouseId,
            recipients: { create: plan.recipientUserIds.map((userId) => ({ userId })) },
          },
          include: { recipients: true },
        });
        const deliveries = notification.recipients
          .filter((r) => emailEnabled.has(r.userId))
          .map((r) => ({ notificationRecipientId: r.id, channel: 'EMAIL' as const }));
        if (deliveries.length > 0) await tx.notificationDelivery.createMany({ data: deliveries });
      });
    } catch (e) {
      // Already created for this (event, rule) — idempotent no-op.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
  }
}
