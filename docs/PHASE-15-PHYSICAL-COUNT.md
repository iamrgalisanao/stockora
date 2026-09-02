# Phase 15 — Physical Count (snapshot → count → variance → post, backend + UI)

**Status: ✅ Complete.** Roadmap step 15, fifth vertical slice. Flow:
`COUNTING → REVIEW → APPROVED → POSTED` (variances post to the ledger as ADJUSTMENT_IN/OUT).

## Backend
- Entities: `stock_counts` + `stock_count_items` (`CountStatus`, `CountType`; `PC-NNNNNN`).
- `CountsService`:
  - `create` — snapshots current on-hand (`systemQty`) and WAC (`unitCost`) for every product with a
    balance in the warehouse (or an optional `productIds` subset). Status COUNTING.
  - `enterCounts` — record `countedQty` per line (repeatable while COUNTING).
  - `submit` — COUNTING → REVIEW (requires all lines counted).
  - `approve` — REVIEW → APPROVED (`inventory.approve`).
  - `post` — APPROVED → POSTED: for each non-zero variance (`counted − system`) posts
    `ADJUSTMENT_IN`/`ADJUSTMENT_OUT` via the posting engine (referenceType `physical_count`,
    idempotent per direction), valuing IN at the snapshot WAC.
  - `cancel` — before POSTED.
- **Blind counts:** while a blind count is still COUNTING, the response omits `systemQty`,
  `varianceQty`, and `varianceValue` (counters can't see expected qty); revealed from REVIEW onward.
- Endpoints under `/api/counts`; count ops gated by `inventory.count`, approval by `inventory.approve`;
  warehouse scope enforced. `cost.view` / `valuation.view` gate unit cost / variance value.

## Web UI
- Pages: **Physical Counts** (list), **Counts → New** (warehouse / type / blind / notes → snapshot),
  **Counts → [id]** (per-line count entry with Save, System/Counted/Variance columns, and workflow
  actions Submit / Approve / Post / Cancel). Nav: added under Control.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **51 e2e** ✅ (3 new count tests:
  snapshot + negative-variance post drives on-hand 100→95; idempotent re-post; blind count hides system
  qty while COUNTING and reveals it at REVIEW).
- Browser walkthrough was **not** re-run for this slice: the in-app browser pane's coordinate scaling
  has been unreliable, and this UI reuses the exact list/new/detail + workflow pattern already verified
  live in Receiving, Releases, Transfers, and Adjustments. Behaviour is covered by the e2e suite.

## Migration
`physical_counts` (stock_counts + stock_count_items).

## Next
The document layer is complete (Receiving, Releases, Transfers, Adjustments, Counts). Next: the
**reorder engine** (reorder-point alerts + suggestions), the **dashboard** (KPIs from Phase 0 §18), and
**reports** — the management-visibility layer.
