import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChannelAdapterRegistry, type NotificationChannelAdapter, type OutboundMessage } from './channel-adapter';

/**
 * Default WEBHOOK adapter for dev/test: records the request (url, headers, body) without any network egress.
 * A real HTTP transport registers for the same channel behind NOTIFICATION_WEBHOOK_TRANSPORT=http.
 */
@Injectable()
export class ConsoleWebhookAdapter implements NotificationChannelAdapter, OnModuleInit {
  readonly channel = 'WEBHOOK';
  readonly sent: Array<Extract<OutboundMessage, { channel: 'WEBHOOK' }>> = [];
  private readonly logger = new Logger('ConsoleWebhook');

  constructor(private readonly registry: ChannelAdapterRegistry) {}

  onModuleInit(): void {
    if (process.env.NOTIFICATION_WEBHOOK_TRANSPORT === undefined || process.env.NOTIFICATION_WEBHOOK_TRANSPORT === 'console') {
      this.registry.register(this);
    }
  }

  async send(message: OutboundMessage): Promise<{ providerMessageId?: string }> {
    if (message.channel !== 'WEBHOOK') throw new Error('ConsoleWebhookAdapter received a non-WEBHOOK message');
    this.sent.push(message);
    this.logger.log(`WEBHOOK → ${message.url} (${message.body.length} bytes)`);
    return { providerMessageId: `console-webhook:${randomUUID()}` };
  }
}
