# Phase 2C.1B — Lot Propagation (backend)

**Status: ✅ Complete.** Second slice of 2C.1. The immutable lot identity from 2C.1A now threads through
**every** physical workflow — releases, transfers, adjustments, physical counts, and returns — for
batch-tracked products, while non-batch workflows behave exactly as before. Governed by
[ADR 0007](adr/0007-batch-lot-tracking.md). No new architectural questions; FEFO/expiry remain 2C.2.

## Releases — explicit lot allocation (the FEFO seam)
A release line gains `ReleaseAllocation[] (lotId, quantity)`. For batch-tracked lines the allocations must
sum to the released quantity; non-batch lines carry none. This is the exact boundary FEFO will later
auto-generate — the release engine never cares who produced the allocations. Each allocation posts one
`SALES_RELEASE` movement at its lot; **per-lot availability** is enforced (allocating 10 from a lot
holding 3 is rejected by the ledger's on-hand guard even when the product total would suffice).

**Reservations stay lot-agnostic** (ADR 0007 §7). Availability at confirm now aggregates on-hand across
all lot rows for the product/warehouse (locked together), while the `reserved` commitment is written to
the **NIL-lot** row. Consuming a batch reservation drops on-hand at the allocated lot(s) and decrements
`reserved` on the NIL row directly (reservations are off-ledger, ADR 0005) — availability nets to zero
change, and the lot ledger stays authoritative.

## Transfers — identity preserved across the state machine
A transfer line carries one `lotId` (multi-lot = multiple lines). Dispatch (`on_hand −q, in_transit +q`)
and receive (`in_transit −q, on_hand +q` at the destination) both carry the **same lotId** — a lot keeps
its identity across warehouses, exactly why warehouse is not part of lot identity.

## Adjustments — explicit lot, never created
A batch adjustment requires an existing `lotId`; a positive adjustment targets an existing lot (adjustments
never create lots — that stays with receiving/opening). Wrong-lot or over-lot adjustments are caught by the
posting layer (lot-not-found `400`, or the negative-stock guard `403`).

## Physical counts — per-lot snapshot & variance
For batch products the snapshot captures **one item per (product, variant, lot)**; variance posts against
the actual lot. Lot redistribution with a correct product total (e.g. system A40/B60, physical A70/B30)
now surfaces as `+30 / −30` variance instead of hiding behind the aggregate.

## Returns — recognized lot, inherited by disposition
A batch return requires a **recognized** lot at intake (returns never create lots); the `RETURN_RECEIPT`
lands quarantine on that lot, and every disposition (RESTOCK / DAMAGED / RETURN_TO_SUPPLIER / DISPOSE)
inherits the return line's lot — the operator is never asked to pick it again.

## Tests
- **e2e** (`lot-propagation.e2e-spec.ts`, 10): batch release requires allocations summing to the line;
  non-batch rejects allocations; per-lot availability; multi-lot release + idempotency; reserved
  consumption with lot allocation (reserved on NIL, on-hand on the lot); transfer preserves lotId through
  dispatch+receive; adjustment requires/validates lot and cannot create or over-draw a lot; count
  snapshots per lot and detects redistribution at zero product-level variance; batch return requires a lot
  and dispositions preserve it; and a **cross-module integration scenario**
  (receive→reserve→release→transfer→return→restock→damage→count) asserting every bucket reconciles to the
  ledger and the product total equals the sum of lot balances. Reservation `confirm` now aggregates
  availability across lots. **34 unit + 208 e2e green.**

## Next
**2C.1C — Traceability UX**: lot explorer, stock-by-lot across warehouses, movement genealogy, document
links, and operational lot selection (largely read-model/UI work over this now-complete engine).
