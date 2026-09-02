# Phase 2B.1C — Expiry + Operational UX (full slice)

**Status: ✅ Complete.** Final slice of 2B.1. Reservations now **expire** on their own and are fully
operable from the application: an operator can create, inspect, filter, consume, release, cancel, and
observe reservations end-to-end. Governed by [ADR 0005](adr/0005-reservations.md). **2B.1 Reservations
is complete.**

## Expiry is a state transition, never a deletion
When `expiresAt <= now`, a still-active reservation (`RESERVED` / `PARTIALLY_CONSUMED`) transitions to
`EXPIRED`. Expiry:
- releases **only the remaining** reserved quantity (`quantity − consumedQuantity`) back to availability,
- **preserves `consumedQuantity`** — physical inventory history is never rewritten,
- sets `completedAt` and audits the transition (`reservation.expired`, `source: SYSTEM`),
- touches **no on-hand ledger movement** — availability rises purely by dropping the `reserved` bucket.

So a reservation of 10 that consumed 4 and then expires releases the remaining **6**; the 4 already
issued stay issued, and the reservation ends `EXPIRED` with `consumedQuantity = 4`.

## Idempotent, concurrency-safe sweep
`expireDue()` finds due reservations, then per reservation runs a transaction that **claims** the row
with a status-guarded `updateMany` (`status IN (RESERVED, PARTIALLY_CONSUMED) → EXPIRED`). A count of 0
means someone already transitioned it — the run skips, so a second sweep (or a concurrent runner) can
**never double-release**. The reserved decrement reuses the same `releaseLineReserved` helper as
release/cancel, under a `FOR UPDATE` balance lock and a `reserved ≥ 0` backstop. One `correlationId` is
minted per sweep, so every reservation expired in a batch is auditable as a single unit of work.

`validateConsumable` (2B.1B) already rejects any status that isn't `RESERVED`/`PARTIALLY_CONSUMED`, so an
`EXPIRED` (or `RELEASED`/`CANCELLED`/`CONSUMED`) reservation cannot be consumed by a later release.

## How expiry runs — a job, not a framework
Per ADR 0005 we did **not** build a scheduler. `ReservationsModule` starts a minimal recurring sweep
(`setInterval`, 60s, `.unref()`, disabled under `NODE_ENV=test`) that calls `expireDue()` across all
orgs. The same logic is exposed as **`POST /reservations/expire-due`** (org-scoped) for on-demand runs
and tests. When domain-events/outbox infrastructure lands, the sweep moves onto it with no semantic change.

## Operational surface (API)
- `GET /reservations` — filter by `status`, `warehouseId`, `sourceType`, `q` (reservation # **or** SKU),
  `expiringSoon`, and a `from`/`to` created-date range. Warehouse-scoped to the caller.
- `GET /reservations/reserved-breakdown?productId&warehouseId[&variantId]` — the active reservation lines
  that compose a balance's `reserved` bucket (the stock drill-down). Sums to the balance's reserved.
- `POST /reservations/expire-due` — run the sweep for the caller's org (`RESERVATION_CANCEL`).

The "expiring soon" window is centralized in `@iw/contracts` as
`RESERVATION_EXPIRING_SOON_HOURS = 24` — one source of truth for the API query and the UI badge.

## Operational surface (Web)
- **/reservations** — list with Reservation #, Source, Warehouse, Status, Reserved, Consumed, Remaining,
  Expires; filters for status, warehouse, source, free-text search, and an "Expiring soon" toggle.
- **/reservations/new** — create a draft (warehouse, source + reference, optional expiry, notes, lines),
  with **Create & confirm** or **Save as draft**.
- **/reservations/[id]** — detail with the line breakdown and **state-based actions only**:
  `DRAFT → Confirm / Cancel`; `RESERVED` / `PARTIALLY_CONSUMED → Release remaining / Cancel remaining`.
  There is deliberately **no "edit quantity"** once confirmed — the commitment is immutable.
- **Stock Overview** now shows **On hand / Reserved / Quarantined / In transit / Available**, and the
  Reserved cell drills into the composing reservations with a live "sum matches balance reserved" check.

## Tests
- **e2e** (`reservation-expiry.e2e-spec.ts`, 11): full unconsumed reservation expires and releases
  reserved; partially consumed reservation expires **remaining only** (consumed preserved); expiry is
  idempotent; expired reservation cannot be consumed; cancel/release before expiry prevents any expiry
  mutation; a future reservation is not expired early; org scope enforced in list + detail; status and
  search (reservation # + SKU) filters; reserved drill-down sums to the balance reserved bucket; a
  historical expired reservation still resolves an archived product; expiration audited under one
  correlation id per sweep. **34 unit + 157 e2e green.**

## Definition of done
> An operator can create, inspect, filter, consume, release, cancel, and observe reservations through the
> application, while expiration automatically returns only unconsumed commitments to availability without
> altering physical inventory history. — met.

## Next
**2B.2 — Returns + Disposition.**
