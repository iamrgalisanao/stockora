/**
 * Domain-event consumer contract (2D.1B, ADR 0010 §4). Delivery is at-least-once; a consumer MUST be
 * idempotent. More than one consumer may subscribe to the same event type — each is tracked independently
 * by a per-consumer receipt, so a retry never repeats a consumer that already succeeded.
 */

/** The event as delivered to a consumer (a snapshot; `occurredAt` is a Date). */
export interface DomainEventEnvelope {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  correlationId: string | null;
  causationId: string | null;
  source: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
}

export interface DomainEventConsumer {
  /** Stable, unique name — the key for this consumer's delivery receipts. Never rename in place. */
  readonly consumerName: string;
  /** The domain event type this consumer subscribes to. */
  readonly eventType: string;
  /** Perform the side effect. Must be idempotent; a throw marks this consumer's delivery as failed. */
  handle(event: DomainEventEnvelope): Promise<void>;
}
