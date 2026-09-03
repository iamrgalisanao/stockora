import { Injectable } from '@nestjs/common';

/** A rendered, channel-agnostic message ready to send. */
export interface RenderedMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

/** Pluggable outbound-channel adapter (ADR 0011 §8). One per channel, selected by configuration. */
export interface NotificationChannelAdapter {
  readonly channel: string;
  /** Hand the message to the transport. Return a provider message id when available. Throw to fail delivery. */
  send(message: RenderedMessage): Promise<{ providerMessageId?: string }>;
}

/** Registry of channel adapters, keyed by channel. A later register() for a channel replaces the earlier one
 *  (so config can swap ConsoleEmailAdapter → SmtpEmailAdapter, and tests can inject a failing adapter). */
@Injectable()
export class ChannelAdapterRegistry {
  private readonly byChannel = new Map<string, NotificationChannelAdapter>();

  register(adapter: NotificationChannelAdapter): void {
    this.byChannel.set(adapter.channel, adapter);
  }

  adapterFor(channel: string): NotificationChannelAdapter | undefined {
    return this.byChannel.get(channel);
  }
}
