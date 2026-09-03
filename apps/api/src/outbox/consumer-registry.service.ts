import { Injectable } from '@nestjs/common';
import type { DomainEventConsumer } from './consumer';

/**
 * In-process registry of domain-event consumers, keyed by event type (many consumers per type). Consumers
 * register themselves (e.g. in onModuleInit); the relay looks them up when dispatching.
 */
@Injectable()
export class ConsumerRegistry {
  private readonly byType = new Map<string, DomainEventConsumer[]>();

  register(consumer: DomainEventConsumer): void {
    const list = this.byType.get(consumer.eventType) ?? [];
    // Idempotent registration by consumerName so a re-init doesn't double-register.
    if (!list.some((c) => c.consumerName === consumer.consumerName)) list.push(consumer);
    this.byType.set(consumer.eventType, list);
  }

  consumersFor(eventType: string): DomainEventConsumer[] {
    return this.byType.get(eventType) ?? [];
  }

  /** Test helper — reset registrations. */
  clear(): void {
    this.byType.clear();
  }
}
