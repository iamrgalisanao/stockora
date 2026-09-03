# Phase 2D.1A — Transactional Outbox Core

**Status: ✅ Complete.** First slice of 2D.1 ([ADR 0010](adr/0010-transactional-outbox.md)). The enqueue seam
only — schema + transactional enqueue API + envelope. **No dispatch yet** (relay is 2D.1B; domain
integrations are 2D.1C).

## Schema
`OutboxEvent` (`outbox_events`) with the ADR 0010 envelope: `eventType`, `aggregateType`/`aggregateId`,
`occurredAt`, `correlationId`, `causationId?`, `source`, `schemaVersion`, `payload` (JSONB), `status`
(`PENDING | PROCESSING | PUBLISHED | FAILED | DEAD_LETTER`), `attemptCount`, `availableAt`, `leaseExpiresAt?`,
`publishedAt?`, `lastError?`, and an optional `dedupeKey` unique per org. Indexed on `(status, availableAt)`
for the relay, and on `(org, aggregate)` / `(org, eventType, occurredAt)` for queries.

## Transactional enqueue
`OutboxService.enqueue(tx, input)` inserts the event **using the caller's transaction client**, so the event
commits or rolls back atomically with the business mutation (ADR 0010 §1):
```ts
await prisma.$transaction(async (tx) => {
  /* …post inventory · update balance · write audit… */
  await outbox.enqueue(tx, { organizationId, eventType: 'InventoryReceived', aggregateType: 'receipt', aggregateId, payload });
});
```
`correlationId` and `source` are taken from the ambient `RequestContext` (SYSTEM / null outside a request);
`schemaVersion` defaults to 1. Enqueue uses `INSERT … ON CONFLICT DO NOTHING` (createMany + skipDuplicates),
so a replayed command carrying the same `dedupeKey` is a silent no-op that **never aborts** the surrounding
transaction.

## Event catalog + envelope
`DOMAIN_EVENT_TYPES` in contracts is the past-tense fact catalog (`InventoryReceived`, `ReservationConfirmed`,
`LotExpiringSoon`, `LotExpired`, `CycleCountCompleted`, `ReorderRequired`, …) — never commands. `payload`
carries a snapshot sufficient to act on, not the whole aggregate; `schemaVersion` travels with every event.

## Tests
- **e2e** (`outbox-core.e2e-spec.ts`, 5): business mutation + outbox row commit atomically with a full
  envelope (correlation id + schema version + source); a business rollback emits nothing; an outbox insert
  failure rolls back the business transaction; a replayed `dedupeKey` does not create a duplicate logical
  event (and does not abort the tx); outside a request context the event is SYSTEM-sourced with no
  correlation id. **34 unit + 276 e2e green.**

## Definition of done (2D.1A)
> A domain fact can be appended to the outbox inside its originating business transaction — committing or
> rolling back atomically with it, carrying a versioned envelope and correlation context, and de-duplicated
> on replay — with no dispatch machinery yet. — met.

## Next
**2D.1B — Relay + Delivery Semantics:** a DB-backed worker (claim/lease with `FOR UPDATE SKIP LOCKED`),
retry/backoff, dead-letter, the idempotent-consumer contract, and health/metrics.
