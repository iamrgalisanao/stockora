# Phase 2D.1B — Relay + Delivery Semantics

**Status: ✅ Complete.** Second slice of 2D.1 ([ADR 0010](adr/0010-transactional-outbox.md)). The DB-backed
dispatch worker + idempotent-consumer contract + health. Domain integrations are 2D.1C.

## Claim + lease (crash-safe, concurrency-safe)
`OutboxRelayService.processBatch()` claims a batch with `SELECT … FOR UPDATE SKIP LOCKED` inside a
transaction and moves rows to `PROCESSING` under a **lease** (`leaseExpiresAt = now + leaseMs`). Eligible =
`PENDING`/`FAILED` whose `availableAt` has arrived, **or** a `PROCESSING` row whose lease expired (crashed-
worker recovery). SKIP LOCKED lets multiple app instances claim disjoint sets without blocking, so running
several pollers is safe. The database is the only coordination mechanism. `processBatch({ organizationId })`
optionally narrows to one tenant (drain a single org / test isolation); omitted, it processes all orgs.

## Delivery (at-least-once, idempotent consumers)
Each claimed event is dispatched **independently** — one poison event never aborts the loop. `attemptCount`
increments when the delivery attempt actually begins (honest accounting). Consumers come from an in-process
`ConsumerRegistry` keyed by event type (**many consumers per type**). For each consumer the relay checks a
**per-consumer receipt** (`ConsumerReceipt`, unique `(consumerName, eventId)`): already-receipted → skip;
otherwise `handle()` then record the receipt. So on a retry a consumer that already succeeded is never
re-run, and a multi-consumer event only re-runs the consumers that failed. All consumers succeeding →
`PUBLISHED` + `publishedAt`. Delivery is **at-least-once; consumers must be idempotent** (a crash between
`handle` and receipt re-runs `handle`).

## Retry / dead-letter
A failed delivery → `FAILED` with `availableAt = now + backoff(attempt)` and a **sanitized** `lastError`
(message only, capped — never a stack or raw object). Backoff is exponential with jitter, capped at
`maxRetryMs`. After `maxAttempts` → `DEAD_LETTER` (payload + diagnostics preserved), never retried forever.
Constants are environment-configurable with safe defaults: `OUTBOX_BATCH_SIZE`, `OUTBOX_LEASE_MS`,
`OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BASE_RETRY_MS`, `OUTBOX_MAX_RETRY_MS`, `OUTBOX_JITTER_MS`.

## Poller
A thin in-process timer (`OutboxPoller`) invokes `processBatch()` on an interval (`OUTBOX_POLL_INTERVAL_MS`,
default 2s), guarded so ticks never stack; it owns no business semantics. Disabled with `OUTBOX_POLLER=off`
and **always inert under tests** (`NODE_ENV=test`) so background timers never mutate shared state during e2e.

## Health
`GET /outbox/health` (org-scoped, `audit.view`): `pending / processing / retrying / deadLetter / published`,
`oldestPendingAgeSeconds`, `lastPublishedAt`, and `expiredLeaseCount` (an early signal of worker crashes or
undersized leases). It is deliberately **separate from `/health/ready`** — a dead-lettered event must not
take the app out of rotation.

## Tests
- **e2e** (`outbox-relay.e2e-spec.ts`, 11): eligible pending claimed → PUBLISHED with full envelope +
  `attemptCount` 1; future `availableAt` skipped; failure → FAILED with future `availableAt` + sanitized
  error; backoff grows across retries; DEAD_LETTER after max attempts; poison event does not block an
  unrelated one; expired lease recovered while a live lease is not stolen; two concurrent `processBatch`
  calls never claim the same row (each processed once per attempt); per-consumer receipt prevents a repeated
  side effect on re-dispatch; multiple consumers per event with per-consumer retry on single-consumer
  failure; org-scoped health reflects queue state. **34 unit + 287 e2e green.**

## Definition of done (2D.1B)
> Pending domain events can be safely claimed by one of multiple workers, delivered at least once to
> registered idempotent consumers, retried with bounded backoff after failure, recovered after worker
> crashes, and dead-lettered without blocking unrelated events — with queue health observable independently
> of the domain transaction. — met.

## Next
**2D.1C — First Domain Integrations:** emit `LotExpiringSoon` / `LotExpired` / `CycleCountCompleted` (facts
already deferred), wire one internal consumer, and a small outbox ops view.
