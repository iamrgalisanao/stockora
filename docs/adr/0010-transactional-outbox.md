# ADR 0010 — Events / Transactional Outbox (Phase 2D.1)

**Status:** Accepted · **Date:** 2026-09-03 · **Related:** [0005 Reservations](0005-reservations.md), [0008 Expiry + FEFO](0008-expiry-fefo.md), [0009 Cycle Counting](0009-cycle-counting.md), Audit (Phase 0 §11)

## Context

Several shipped capabilities deliberately produce **facts, not notifications** — expiry facts (ADR 0008 §10),
cycle-count metrics/coverage, reorder assessment — and deferred delivery to "a future outbox". Phase 2D.1
builds that outbox: the reliable seam between a committed domain fact and its asynchronous downstream
processing. This ADR freezes the model before any migration.

## Core principle

> A domain transaction and the fact that it happened must commit **atomically**; delivery of that fact
> happens **asynchronously** and may be **retried without repeating the domain transaction**.

## Core decisions

**1. The outbox row is written INSIDE the same DB transaction as the business mutation.**
```
BEGIN
  post inventory · update balance · write audit · insert OutboxEvent
COMMIT
```
Never `COMMIT` the domain change and *then* insert the event — that reintroduces the exact dual-write
reliability gap the pattern exists to close. Enqueue takes the caller's transaction client; if the domain
transaction rolls back, so does the event, and vice-versa.

**2. Envelope.**
```
OutboxEvent
- id
- organizationId
- eventType          // past-tense domain fact
- aggregateType, aggregateId
- occurredAt
- correlationId      // reused from RequestContext (ADR: Audit)
- causationId?       // the event/command that caused this one
- source             // USER | SYSTEM | ...
- schemaVersion      // from day one — events outlive API contracts
- payload            // JSON snapshot, enough to act on; NOT the whole aggregate
- status
- attemptCount
- availableAt        // next eligible dispatch time (retry backoff)
- publishedAt?
- lastError?         // sanitized
- leaseExpiresAt?    // crash-recovery lease for PROCESSING
```

**3. Events are factual and past-tense — domain facts, never commands.** Catalog (grown as needed):
`InventoryReceived, InventoryReleased, InventoryTransferred, InventoryAdjusted, ReservationConfirmed,
ReservationConsumed, ReturnReceived, ReturnDispositionPosted, LotExpiringSoon, LotExpired,
CycleCountCompleted, ReorderRequired`. **Not** `SendLowStockEmail` / `NotifyManager` — those are consumer
decisions, not facts.

**4. Delivery is at-least-once; consumers MUST be idempotent.** No global ordering is promised. If ordering
matters it is guaranteed only within an aggregate / explicit partition key; a monotonic aggregate sequence is
added only when a consumer actually needs it (not in v1). **Consumer idempotency is the most important
contract.**

**5. Lifecycle.** `PENDING → PROCESSING → PUBLISHED`, with `FAILED` (transient, will retry) and
`DEAD_LETTER` (bounded attempts exhausted). A row never stays permanently `PROCESSING`: a claim takes a
**lease** (`leaseExpiresAt`) / uses `availableAt`, so a crashed worker's rows become claimable again.

**6. Dispatch is a DB-backed worker** claiming small batches with `SELECT … FOR UPDATE SKIP LOCKED` (or the
runtime equivalent). On failure: `attemptCount++`, `availableAt = now + exponential-backoff (capped)`,
`lastError = sanitized`. After a bounded number of attempts → `DEAD_LETTER` (never retry forever). A poison
event must not block unrelated events (per-row claim, not head-of-line).

**7. The domain outbox is not an email/webhook retry table.** External channels arrive with Notifications:
```
Domain Outbox → Notification consumer → Notification record / delivery queue → email / chat / webhook
```
`PUBLISHED` means the event was handed to its in-process consumer(s) successfully — not that some external
channel succeeded forever. Channel-level retries live in the Notification layer (2D.2), keeping the domain
outbox clean.

**8. Payloads carry a snapshot, not the aggregate.** Enough for a consumer to act without unsafe dependence
on mutable current state; not a full copy. Example:
```json
{ "reservationId": "…", "reservationNo": "RES-1024", "warehouseId": "…", "productId": "…", "remainingQuantity": "20" }
```
`schemaVersion` is present from the first event. `correlationId` / `source` / actor context propagate from
`RequestContext`; `causationId` links a caused event to its cause.

**9. Audit and domain events stay separate systems.** Audit answers *who did what*; a domain event states
*what business fact occurred*. Some operations emit both; the outbox does **not** absorb the audit log, and
existing audit entries are **not** migrated into it.

## Slices

- **2D.1A — Transactional Outbox Core:** `OutboxEvent` schema + migration; a transactional `enqueue(tx, …)`
  API; envelope construction (correlation/causation/source/schemaVersion); event-type catalog in contracts.
  **No dispatch yet** beyond tests that prove atomicity.
- **2D.1B — Relay + Delivery Semantics:** the worker (claim/lease with SKIP LOCKED), retry/backoff,
  dead-letter, the idempotent-consumer contract + a consumer registry, and health/metrics.
- **2D.1C — First Domain Integrations:** emit `LotExpiringSoon` / `LotExpired` / `CycleCountCompleted`
  (facts already deferred, no inventory-state change), wire one internal consumer, and a small outbox ops
  view. (Broader event choreography is added later, not everywhere at once.)

## Mandatory invariants (tested across the slices)

Business transaction + outbox row commit atomically; a business rollback produces no event; an outbox-insert
failure rolls back the business transaction; a replayed command does not create a duplicate logical event;
the envelope carries a correlation id and a schema version; a consumer receives an event at least once;
consumer idempotency prevents duplicate side effects; failed delivery retries with backoff respected; a
crashed `PROCESSING` lease becomes claimable again; concurrent workers never process the same claim; success
reaches `PUBLISHED`; persistent failure reaches `DEAD_LETTER`; one poison event does not block unrelated
events; org isolation preserved in consumers; secret/redacted fields never emitted; the expiry event is
generated once per threshold crossing; the cycle-count completion event is emitted only after POSTED; audit
remains independent from the outbox.

## Definition of done (2D.1)

> Any domain fact selected for asynchronous processing can be committed atomically with its originating
> business transaction and delivered at least once through a retryable, observable, idempotent mechanism —
> without coupling the domain transaction to email, chat, webhook, or other external delivery channels.
