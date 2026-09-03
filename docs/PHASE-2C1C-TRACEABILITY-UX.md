# Phase 2C.1C — Traceability UX + Visibility

**Status: ✅ Complete.** Final slice of 2C.1. The lot engine is now inspectable and actionable from the
application. This **completes 2C.1 Batch/Lot Tracking.** Read-model + operational-selection only — no new
inventory semantics (ADR 0007).

## Read endpoints
- **`GET /lots`** — Lot Explorer feed, filters: product, free-text (lot # / SKU), status, supplier,
  warehouse (has a balance there), and `hasStock`. Totals aggregate across in-scope warehouses.
- **`GET /lots/:id`** — summary + **per-warehouse** stock breakdown (never collapsed to one opaque total).
- **`GET /lots/:id/movements`** — the chronological lot timeline: each ledger event with its bucket
  deltas and its **resolved source document** (`goods_receipt`→GR-…, `stock_release`→REL-…,
  `stock_transfer`→TR-…, `stock_adjustment`→…, `stock_count`→…, `inventory_return`→RTN-…), plus labels for
  non-document events (opening balance, legacy migration, reversal). Counts now post under a `stock_count`
  reference so their movements resolve to the count.
- **`GET /lots/pickable`** — the shared operational picker feed: ACTIVE lots of a product with stock at a
  warehouse, each with on-hand / reserved / quarantined / **available** / expiry.

## Screens
- **/lots** — Lot Explorer: filters + table (lot #, product, status, manufactured, expiry, on-hand,
  quarantined, damaged) with a **Migrated** badge on `LEGACY_MIGRATION` lots so reconstructed legacy stock
  is never mistaken for manufacturer-grade traceability.
- **/lots/[id]** — Lot Detail: summary, **stock by warehouse**, and the **movement history** timeline with
  clickable document links back to the source receipt/transfer/release/return.
- **`<LotPicker>`** — one shared component (`components/LotPicker.tsx`) for every operational workflow:
  it lets an operator **select a recognized `InventoryLot`** with per-warehouse availability/expiry —
  batch-tracked products can never type a free-text lot downstream; non-batch products show no lot
  control. Wired into return intake as the reference integration; the same contract drops into
  release/transfer/adjustment/count. FEFO does not auto-select here (2C.2) — lots are listed expiry-asc as
  a neutral display only.

## Tests
- **e2e** (`lot-traceability.e2e-spec.ts`, 6): explorer filters + org isolation; same lot across multiple
  warehouses in detail; timeline is chronological and resolves documents; picker returns only ACTIVE
  in-stock lots of the product with available quantity and excludes the wrong product; synthetic legacy
  lot identified by origin; and an **acceptance scenario** tracing one lot across
  receive→transfer→release→return→restock→damage→count, asserting the whole chain is visible from the lot
  with correct document references and per-warehouse stock. **34 unit + 214 e2e green.**
- Browser-verified: Explorer, Detail (stock-by-warehouse + timeline links), and the picker gating
  batch vs non-batch on return intake.

## Definition of done
> An authorized user can identify any lot, see where its stock currently exists, trace every inventory
> event and source document that affected it, and select the correct existing lot in operational
> workflows without bypassing lot identity rules. — met. **2C.1 Batch/Lot Tracking is complete.**

## Next
**2C.2 — Expiry + FEFO**: shelf-life rules, first-expired-first-out auto-allocation (generating the
`ReleaseAllocation[]` the picker/engine already consume), expired-stock handling, and expiry alerting —
built on the now-frozen lot identity model.
