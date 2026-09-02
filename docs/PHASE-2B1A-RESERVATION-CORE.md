# Phase 2B.1A — Reservation Core (backend)

**Status: ✅ Complete.** First slice of 2B.1 Reservations. Create / confirm / release / cancel with
availability enforcement, concurrency safety, and audit. Governed by
[ADR 0005](adr/0005-reservations.md).

## Model
`InventoryReservation` (header) + `ReservationLine`. A line keys on `productId` + optional `variantId`
(NIL-UUID = base product) to match the balance grain; `locationId` is an advisory hint only in this
slice (no location-level availability yet). Header carries `sourceType`
(`MANUAL`/`INTERNAL_REQUEST`/`EXTERNAL`) + opaque `sourceId`.

## Commitment, not movement
Confirming a reservation adjusts the balance **`reserved` bucket** — it never posts a ledger movement,
and `on_hand` is unchanged. `available = on_hand − reserved − quarantined`. (On-hand only moves at
consumption, 2B.1B.) The e2e proves a confirmed reservation leaves `on_hand=100`, `reserved=30`,
`available=70`.

## Commands & lifecycle
- **create** → `DRAFT` (validates warehouse active + in scope, each product/variant ACTIVE, optional
  location in-warehouse + ACTIVE; no availability check yet).
- **confirm** `DRAFT → RESERVED` — the commitment. Locks the affected balance rows
  `SELECT … FOR UPDATE` **in deterministic order** (sorted by `productId|variantId`), validates
  `requested ≤ available` per line, then increments `reserved`. Idempotent (re-confirm returns as-is).
- **release** `RESERVED/PARTIALLY_CONSUMED → RELEASED` and **cancel**
  `DRAFT/RESERVED/PARTIALLY_CONSUMED → CANCELLED` — both return remaining reserved to availability
  (cancel from DRAFT returns nothing). Idempotent.

Transitions are enforced by an explicit table; consumed/released/expired/cancelled are terminal.

## Concurrency & atomicity
Each command is one interactive transaction. Because confirms lock the same balance row, two concurrent
confirmations **serialize** and cannot oversubscribe — verified by a race test (exactly one of two
60-unit confirms against 100 on-hand succeeds). A multi-line confirm is **all-or-nothing**: one
insufficient line rolls back every line.

## Security & audit
Org-isolated and warehouse-scoped (out-of-org → 404, out-of-scope create → 403). Every command emits an
audit fact (`reservation.created/confirmed/released/cancelled`) with the warehouse and reservation
number, carrying the request correlation id. Historical reservations stay readable after the product is
archived.

## Permissions
`reservation.view / create / confirm / release / cancel` wired to roles;
`reservation.override` reserved (unused until oversubscription).

## Tests
- **e2e** (`reservations.e2e-spec.ts`, 8): reserve-sufficient (commitment, no movement); reject
  insufficient; concurrent no-oversubscribe; multi-line atomic; inactive product/warehouse/location
  refused; release + cancel return to availability; org isolation + warehouse scope + audit correlation;
  historical readable after archival. **34 unit + 141 e2e green.**

## Next
**2B.1B — Consumption**: release documents consume reservations (line-level reference, partial
consumption, atomic `reserved`+`on_hand` decrement via the ledger, idempotent). Then **2B.1C** —
expiry + operational UX.
