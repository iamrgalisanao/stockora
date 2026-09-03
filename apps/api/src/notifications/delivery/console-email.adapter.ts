import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChannelAdapterRegistry, type NotificationChannelAdapter, type RenderedMessage } from './channel-adapter';

/**
 * The default EMAIL adapter for dev/test: logs the message and records it (no external provider, no secrets).
 * A real transport (SmtpEmailAdapter / ProviderEmailAdapter) registers for the same channel behind config.
 */
@Injectable()
export class ConsoleEmailAdapter implements NotificationChannelAdapter, OnModuleInit {
  readonly channel = 'EMAIL';
  /** In-memory record of sent messages (dev/test introspection). */
  readonly sent: RenderedMessage[] = [];
  private readonly logger = new Logger('ConsoleEmail');

  constructor(private readonly registry: ChannelAdapterRegistry) {}

  onModuleInit(): void {
    // Only the default; a configured real transport would register over this.
    if (process.env.NOTIFICATION_EMAIL_TRANSPORT === undefined || process.env.NOTIFICATION_EMAIL_TRANSPORT === 'console') {
      this.registry.register(this);
    }
  }

  async send(message: RenderedMessage): Promise<{ providerMessageId?: string }> {
    this.sent.push(message);
    this.logger.log(`EMAIL → ${message.to} · ${message.subject}`);
    return { providerMessageId: `console:${randomUUID()}` };
  }
}
