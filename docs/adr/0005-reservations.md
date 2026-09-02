# ADR 0005 — Reservations (commitments against availability)

## Status
Accepted — 2026-09-02. Governs Phase 2B.1 (Reservations): 2B.1A Core, 2B.1B Consumption, 2B.1C Expiry.

## Core principle
> **Reservations are commitments against _availability_, not physical inventory movements. Physical
> stock changes only when a stock movement is posted to the ledger.**

Reserving, releasing, cancelling and expiring never write to the append-only movement ledger — they
adjust the `reserved` bucket on the balance projection. On-hand changes only at **consumption** (2B.1B),
when a real `SALES_RELEASE` movement is posted. This keeps ledger semantics clean for the Sales-Order,
allocation-strategy, FEFO and mobile-picking work to come.

## Ownership of the `reserved` bucket
`InventoryBalance.reserved` was previously always zero (no writer). From 2B.1 it is **owned by the
reservation aggregate**: the sum of remaining reserved quantity across active reservation lines,
maintained transactionally under the same row lock as on-hand. It is not derived from ledger movements.

## Aggregate
`InventoryReservation` (header) + `ReservationLine`. To match the balance projection grain, a line keys
on `productId` + optional `variantId` (the NIL-UUID sentinel = base product), **not** a bare
`productVariantId` — consistent with inventory policies and balances.

- Header: `id, organizationId, reservationNo, warehouseId, sourceType, sourceId?, status, expiresAt?,
  notes?, createdById, createdAt, confirmedAt?, completedAt?`.
- Line: `id, reservationId, productId, variantId, locationId?, quantity, consumedQuantity` (+ future
  `batchId`/`serialId`).

## Invariants (locked)
- `available = on_hand - reserved - quarantined`.
- A reservation confirm requires `requested <= available`; it can never make `available` negative.
- Reserving does not move physical stock; `on_hand` is unchanged by reserve/release/cancel/expire.
- Reserved quantity belongs to exactly one reservation line.
- Consuming decreases `reserved` and `on_hand` **atomically** (2B.1B).
- Released / cancelled / expired remaining quantity returns to `available`.
- `consumedQuantity <= quantity`, always.
- A CONSUMED/POSTED reservation's history is immutable.
- Every state-changing command is idempotent where replay is plausible.

## Lifecycle & allowed transitions
`DRAFT · RESERVED · PARTIALLY_CONSUMED · CONSUMED · RELEASED · EXPIRED · CANCELLED`

```
DRAFT              → RESERVED | CANCELLED
RESERVED           → PARTIALLY_CONSUMED | CONSUMED | RELEASED | EXPIRED | CANCELLED
PARTIALLY_CONSUMED → CONSUMED | RELEASED | EXPIRED | CANCELLED
```
No transition ever returns to `DRAFT` or `RESERVED` after consumption; CONSUMED/RELEASED/EXPIRED/
CANCELLED are terminal.

**Reconciliation note:** the locked spec listed only `RESERVED/PARTIALLY_CONSUMED → RELEASED` yet also
mandated a "cancel returns quantity to available" test. We therefore also permit
`RESERVED/PARTIALLY_CONSUMED → CANCELLED`. RELEASE and CANCEL are siblings — both return the remaining
reserved quantity to availability — differing only in recorded intent (fulfilled-and-freed vs aborted).

## Concurrency
Reserve/release/cancel run in one interactive transaction. Affected balance rows are locked
`SELECT … FOR UPDATE` (the pattern proven in the posting service) in a **deterministic order**
(sorted by `productId|variantId|warehouseId`) before any validation, so multi-line reservations don't
deadlock and two concurrent reservations cannot oversubscribe.

## Location policy (2B.1A)
Balances are warehouse+variant grained (no location dimension yet), so **reservations commit against
warehouse+variant availability**. `locationId` on a line is accepted and stored as an advisory hint but
is **not** enforced against per-location availability, and there is **no automatic split across
locations** — that belongs to a future allocation-strategy / inventory-position layer (2C.4).

## Source model
`sourceType ∈ {MANUAL, INTERNAL_REQUEST, EXTERNAL}` with an opaque `sourceId` external reference. No
Sales-Order semantics yet.

## Permissions
`reservation.view / create / confirm / release / cancel / override`. `reservation.override` is defined
but unused until oversubscription is supported — a reserved future boundary.

## Consumption (2B.1B, forward-looking)
A release document references reservations at the **line** level (one release may consume some reserved
and some unreserved lines). The consume flow is one transaction: lock reservation line + balance →
validate remaining reserved and release qty → `reserved -= q`, `on_hand -= q`, `consumedQuantity += q`,
post the `SALES_RELEASE` movement, update reservation status, audit. Idempotent so a replayed release
never double-decrements.
