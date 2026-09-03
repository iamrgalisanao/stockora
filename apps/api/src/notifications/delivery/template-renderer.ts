import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Notification } from '@prisma/client';
import type { WebhookEventPayload } from '@iw/contracts';
import type { OutboundMessage } from './channel-adapter';

const ROUTES: Record<string, (id: string) => string> = {
  lot: (id) => `/lots/${id}`,
  cycle_count_task: (id) => `/cycle-count/tasks/${id}`,
};
const WEBHOOK_SCHEMA_VERSION = 1;

/** Centralized notification → message rendering (ADR 0011). Email = text + simple HTML with a deep link;
 *  webhook = a stable, versioned JSON payload with an HMAC signature when a secret is configured. */
@Injectable()
export class NotificationTemplateRenderer {
  private readonly baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

  private deepLink(n: Notification): string | null {
    return n.entityType && n.entityId && ROUTES[n.entityType] ? `${this.baseUrl}${ROUTES[n.entityType]!(n.entityId)}` : null;
  }

  renderEmail(notification: Notification, to: string): Extract<OutboundMessage, { channel: 'EMAIL' }> {
    const link = this.deepLink(notification);
    const textBody = link ? `${notification.message}\n\nOpen: ${link}` : notification.message;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const htmlBody = `<p>${esc(notification.message)}</p>${link ? `<p><a href="${esc(link)}">Open in app</a></p>` : ''}`;
    return { channel: 'EMAIL', to, subject: notification.title, textBody, htmlBody };
  }

  /** Build the versioned webhook payload for a notification/delivery. */
  webhookPayload(notification: Notification, deliveryId: string): WebhookEventPayload {
    return {
      schemaVersion: WEBHOOK_SCHEMA_VERSION,
      deliveryId,
      eventId: notification.eventId,
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      occurredAt: notification.createdAt.toISOString(),
      organizationId: notification.organizationId,
      warehouseId: notification.warehouseId,
      entity: notification.entityType && notification.entityId ? { type: notification.entityType, id: notification.entityId } : null,
      title: notification.title,
      message: notification.message,
    };
  }

  renderWebhook(notification: Notification, deliveryId: string, url: string, signingSecret: string | null): Extract<OutboundMessage, { channel: 'WEBHOOK' }> {
    const payload = this.webhookPayload(notification, deliveryId);
    const body = JSON.stringify(payload); // sign the EXACT serialized body
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-inventory-event-id': notification.eventId,
      'x-inventory-delivery-id': deliveryId,
    };
    if (signingSecret) headers['x-inventory-signature'] = `sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}`;
    return { channel: 'WEBHOOK', url, headers, body };
  }
}
