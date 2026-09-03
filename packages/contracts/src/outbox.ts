/**
 * Transactional outbox contracts (Phase 2D.1, ADR 0010). Domain events are past-tense FACTS committed
 * atomically with their business transaction and delivered asynchronously, at-least-once, to idempotent
 * consumers. The outbox is not the audit log and not a notification retry table.
 */

export const OUTBOX_STATUSES = ['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** The domain-event catalog (ADR 0010 §3). Past-tense facts only — never commands. Grown as needed. */
export const DOMAIN_EVENT_TYPES = [
  'InventoryReceived',
  'InventoryReleased',
  'InventoryTransferred',
  'InventoryAdjusted',
  'ReservationConfirmed',
  'ReservationConsumed',
  'ReturnReceived',
  'ReturnDispositionPosted',
  'LotExpiringSoon',
  'LotExpired',
  'CycleCountCompleted',
  'ReorderRequired',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** Outbox queue health (2D.1B). Observable independently of the domain transaction; org-scoped. */
export interface OutboxHealthResponse {
  pending: number;
  processing: number;
  retrying: number; // FAILED, awaiting a retry
  deadLetter: number;
  published: number;
  oldestPendingAgeSeconds: number | null;
  lastPublishedAt: string | null;
  expiredLeaseCount: number; // PROCESSING rows past their lease — early signal of worker crashes
}

/** Ops-table row (2D.1C) — queue-health-level detail, WITHOUT the payload (payload is gated more tightly). */
export interface OutboxEventListItem {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: OutboxStatus;
  attemptCount: number;
  occurredAt: string;
  availableAt: string;
  publishedAt: string | null;
  correlationId: string | null;
  lastError: string | null;
}

/** A read view of an outbox row (ops surface — 2D.1C). Payload is the event snapshot. */
export interface OutboxEventResponse {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId: string | null;
  causationId: string | null;
  source: string;
  schemaVersion: number;
  status: OutboxStatus;
  attemptCount: number;
  availableAt: string;
  publishedAt: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
}
