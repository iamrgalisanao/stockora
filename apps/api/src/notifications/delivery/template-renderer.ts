import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import type { RenderedMessage } from './channel-adapter';

const ROUTES: Record<string, (id: string) => string> = {
  lot: (id) => `/lots/${id}`,
  cycle_count_task: (id) => `/cycle-count/tasks/${id}`,
};

/** Centralized notification → message rendering (ADR 0011 §content). Plain text + simple HTML; deep link
 *  back into the app when the entity has a route. No templating DSL. */
@Injectable()
export class NotificationTemplateRenderer {
  private readonly baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

  render(notification: Notification, to: string): RenderedMessage {
    const link = notification.entityType && notification.entityId && ROUTES[notification.entityType]
      ? `${this.baseUrl}${ROUTES[notification.entityType]!(notification.entityId)}`
      : null;
    const textBody = link ? `${notification.message}\n\nOpen: ${link}` : notification.message;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const htmlBody = `<p>${esc(notification.message)}</p>${link ? `<p><a href="${esc(link)}">Open in app</a></p>` : ''}`;
    return { to, subject: notification.title, textBody, htmlBody };
  }
}
