# Phase 2B.2B — Inspection + Disposition (backend)

**Status: ✅ Complete.** Second slice of 2B.2. Quarantined returned stock can now be **inspected and
split across disposition outcomes**, each posted immutably through the ledger. Governed by
[ADR 0006](adr/0006-returns-disposition.md).

## The four outcomes (explicit ledger deltas)
Each disposition is its own immutable movement (ADR 0006 §"Bucket & ledger semantics"):

| Outcome | Movement type | onHand | quarantined | damaged | Effect |
|---|---|---:|---:|---:|---|
| RESTOCK | `RETURN_RESTOCK` | 0 | −q | 0 | Release the hold → stock becomes sellable (availability +q). |
| DAMAGED | `DAMAGE` | −q | −q | +q | Move out of the primary pool into the damaged pool. |
| RETURN_TO_SUPPLIER | `SUPPLIER_RETURN` | −q | −q | 0 | Ship back out of the building. |
| DISPOSE | `RETURN_DISPOSE` | −q | −q | 0 | Scrap out of the building. |

`RETURN_TO_SUPPLIER` and `DISPOSE` carry identical deltas but keep **distinct movement + disposition
types** — they are different business events and will diverge in reporting, supplier analytics, and audit.

## Durable truth + concurrency
`remainingQuarantined = receivedQuantity − Σ dispositionQuantity`. Every disposition:
1. locks the **return line** `FOR UPDATE` and reads `receivedQuantity`/`disposedQuantity` under that lock,
2. rejects `quantity > remaining` (a clean `400`) — the primary guard,
3. posts the movement, whose `quarantined`/`damaged` **never-negative** bucket guards are the second guard,
4. records an **immutable** `ReturnDisposition` row and increments `disposedQuantity`,

all in **one transaction**. Concurrent dispositions on a line serialize on the row lock, so they can
never over-dispose. Durable truth is `receivedQuantity` + the immutable disposition rows; the cached
`disposedQuantity` is transactionally maintained, and the balance buckets reconcile against the ledger.

**Idempotency**: an optional client `idempotencyKey` maps to the movement's org-unique idempotency key —
a replay finds the prior movement and does nothing (a concurrent replay that loses the insert race is
caught as a unique violation and treated as a no-op). Dispositions are never edited after posting; a
wrong call is corrected by a compensating disposition, never by rewriting history.

## Status roll-up (mechanical, from all lines)
```
Σ disposed == 0                     → RECEIVED
0 < Σ disposed < Σ received         → PARTIALLY_DISPOSED
Σ disposed == Σ received            → COMPLETED (+ completedAt)
```
Computed across **every** line of the document, not the one just touched. A COMPLETED return rejects
further disposition (`409`).

## Permissions (refined in ADR 0006)
Condition outcomes **RESTOCK / DAMAGED** need `return.inspect` (the endpoint floor); the
outbound/irreversible **RETURN_TO_SUPPLIER / DISPOSE** additionally need `return.dispose`, checked
in-service against the caller's permissions. Warehouse staff (inspect, no dispose) can restock and mark
damaged but not ship-back or scrap.

## Tests
- **e2e** (`return-disposition.e2e-spec.ts`, 13): partial vs full RESTOCK status; mixed outcomes on one
  line; multi-line roll-up; over-dispose rejected; concurrent dispositions cannot over-dispose; replay
  idempotent; RESTOCK raises availability without touching on_hand; DAMAGED moves on_hand→damaged;
  RETURN_TO_SUPPLIER and DISPOSE reduce physical stock; completed return rejects further disposition;
  staff blocked from destructive outcomes; disposition audited under a correlation id + ledger reference.
  **Every test reconciles the persisted balance buckets against the ledger deltas** (the check that would
  have caught the latent 2B.2A `CUSTOMER_RETURN` bug). **34 unit + 181 e2e green.**

## Next
**2B.2C — UX + Visibility**: operational return screens, quarantine breakdown + stock drill-down,
filters, and disposition history.
