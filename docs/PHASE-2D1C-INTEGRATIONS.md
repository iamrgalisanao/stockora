# Phase 2D.1C — First Domain Integrations

**Status: ✅ Complete.** Final slice of 2D.1 ([ADR 0010](adr/0010-transactional-outbox.md)). Existing domain
facts now flow through the outbox to an idempotent internal consumer, observable operationally — **no
notification coupling.** **This completes 2D.1 Events / Transactional Outbox.**

## Emit sites (event enqueued in the same transaction as the fact)
- **`LotExpiringSoon` / `LotExpired`** — the expiry scan now inserts each **new** `LotExpiryFact` and its
  outbox event in one transaction (`dedupeKey = lot-expiry-fact:<factId>`). The fact remains the durable
  read-model record; the outbox is the delivery mechanism. A repeat scan that finds the fact already present
  updates `daysRemaining` only — **no duplicate fact, no duplicate event** (the P2002 path carries no event).
- **`CycleCountCompleted`** — enqueued in the same transaction that flips the cycle-count task to
  `COMPLETED` after its `StockCount` posts (`dedupeKey = cycle-count-completed:<taskId>`). If the completion
  rolls back, the event disappears with it; a premature/failed post emits nothing. Compact payload
  (task/count ids, warehouse/product/variant/lot, abcClass, expected/counted/variance, completedAt) — never
  the whole count.

Both inherit their fact's once-per-crossing idempotency, and the envelope carries the originating request's
`correlationId`.

## First internal consumer
`OperationalFactConsumer` (registered for all three types) projects delivered facts into
`OperationalFactProjection` — a durable read model (`entityType`, `entityId`, `summary`, `metadata`). It
proves **domain-tx → outbox → relay → idempotent consumer → projection** with no notification semantics, and
is idempotent both by the relay's per-consumer receipt and its own unique `eventId`. Summaries read like
*"Lot LOT-B expired"* / *"Cycle count completed with variance -3"* — a seed for 2D.2 Notifications.

## Ops surface
`GET /outbox/events` (org-scoped, `audit.view`) lists recent rows for the ops table — **without payload**
(gated more tightly). `POST /outbox/:id/retry` (`settings.manage`) requeues a `FAILED`/`DEAD_LETTER` event
(→ PENDING, `availableAt` now, `lastError` cleared) while **preserving `attemptCount`** (lifetime history).
Web `/outbox` shows the health tiles (pending / retrying / processing / dead-letter / published / oldest
pending / last published) and a recent-events table (time, type, aggregate, status, attempts, correlation,
last error) with a permission-gated Retry.

## Tests
- **e2e** (`outbox-integration.e2e-spec.ts`, 6): expiring-soon fact + event commit together with the request
  correlation id, and a repeat scan adds neither; `LotExpired` emitted once and delivered to the projection,
  projection idempotent on replay; `CycleCountCompleted` only after POSTED (not on a failed post) with the
  compact payload, delivered to the projection; org-scoped health/recent-events (another org sees nothing);
  manual retry requires `settings.manage` and preserves attempt history; a second failing consumer does not
  duplicate the already-successful projection. **34 unit + 293 e2e green.** Browser-verified the Outbox Ops
  page (two expiry events published end-to-end by the live poller with correlation ids).

## Definition of done (2D.1C / 2D.1)
> Existing expiry and cycle-count domain facts are committed atomically into the transactional outbox,
> delivered through the relay to an idempotent internal consumer, and observable operationally without
> coupling the domain to notification channels. — met. **2D.1 Events / Transactional Outbox is complete.**

## Next
**2D.2 — Notifications:** a notification consumer over the domain outbox → notification records / delivery
queue → channels (email / chat / webhook), keeping the domain outbox free of channel-retry concerns.
