# Phase 2B.1B — Reservation Consumption (backend)

**Status: ✅ Complete.** Second slice of 2B.1. A stock release can now **consume** a reservation:
posting the release turns the commitment into a physical issue, decrementing `on_hand` and `reserved`
together, atomically, through the ledger. Governed by [ADR 0005](adr/0005-reservations.md).

## Line-level linkage
A **release line** may carry an optional `reservationLineId` (not just the header) — so one release can
consume several reserved lines and also issue unreserved ones in the same document. `StockReleaseItem`
gains `reservationLineId` (FK → `ReservationLine`, `ON DELETE SET NULL`).

## The consume flow (atomic via the ledger)
At **post**:
1. Every reservation-backed line is validated up front (`validateConsumable`): the reservation is
   `RESERVED`/`PARTIALLY_CONSUMED`, same warehouse + product/variant, and `qty ≤ remaining reserved` —
   a clean `400` before anything posts.
2. A reserved line's `SALES_RELEASE` movement carries **both** `onHandDelta = −q` and
   `reservedDelta = −q` (via the new `StockLine.deltas` override), so on-hand and reserved drop in the
   **same movement transaction** — availability is unchanged (the stock was already committed away). An
   unreserved line uses the default on-hand-only delta.
3. In the release's post transaction, each consumed line's `consumedQuantity` is incremented and the
   parent reservation rolls to `PARTIALLY_CONSUMED` or `CONSUMED` (with `completedAt`).
4. Audit: `stock_release.posted` plus a `reservation.consumed` fact per reservation (carrying the
   release number + resulting status), all under the request correlation id.

## Idempotency & safety
- Re-posting a release is a no-op (post returns early once `RELEASED`) — **no double decrement**.
- `consumedQuantity ≤ quantity` is enforced by up-front validation, and the balance's existing
  "reserved may never go negative" guard is a second backstop.
- Over-consumption is rejected before any movement; on failure nothing is consumed.

## Tests
- **e2e** (`reservation-consumption.e2e-spec.ts`, 5): partial consumption (on_hand + reserved drop
  together, availability unchanged, `PARTIALLY_CONSUMED`); full consumption reaches `CONSUMED`;
  over-consumption rejected; replayed post doesn't double-decrement; mixed reserved + unreserved release.
  Existing release e2e still green. **34 unit + 146 e2e green.**

## Next
**2B.1C — Expiry + UX**: `expiresAt` enforcement (a state transition that returns remaining reserved to
availability + emits audit), plus the operational screens, stock visibility, and search/filtering.
