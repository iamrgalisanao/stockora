# Phase 17 + 19 — Reorder Engine & Dashboard (management visibility, slice A)

**Status: ✅ Complete and verified (backend + UI).** Roadmap steps 17 (reorder) and 19 (dashboard).
Both are computed read-models over the ledger/balances — no new tables.

## Reorder engine (`GET /api/reorder/recommendations`)
For every tracked product with a reorder point set, compares **available** (Σ on_hand − reserved −
quarantined across the user's warehouses) against the reorder point and, when at/below it, returns:
on_hand, reserved, available, **incoming** (Σ expected qty on not-yet-posted goods receipts),
reorder point, **suggested qty** (`reorderQty`, else `maxStock − available`, else to reach the point),
preferred supplier, lead time, and **estimated cost** (suggested × preferred-supplier or product cost,
gated by `cost.view`). Sorted most-urgent first.

## Dashboard (`GET /api/dashboard/summary`)
Phase 0 §18 KPIs, warehouse-scope aware: total SKUs, on-hand, available, reserved, in-transit,
**inventory value** (`Σ on_hand × avg_cost`, gated by `valuation.view`), **low-stock / out-of-stock /
to-reorder** exception counts, **pending** document counts (receipts/releases/transfers/adjustments/
counts, each by non-terminal status), and the 5 most recent ledger movements.

## Web UI
- **Dashboard** rebuilt as an exception-first view: KPI cards, a "Needs attention" row (To reorder /
  Low stock / Out of stock, linking to Reorder), a "Pending documents" row (linking to each queue),
  and a recent-movements table.
- **Reorder** page (nav: Supply) listing recommendations with suggested quantities and est. cost.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **53 e2e** ✅ (2 new analytics
  tests: reorder recommends only below-point products with correct suggested qty/incoming/est cost;
  dashboard KPI/exception/pending math).
- **Live browser walkthrough:** dashboard showed SKUs 2, on-hand 40, value ₱89,225, To reorder 1, and
  the recent-movements ledger; Reorder listed CABLE-1 (available 5, reorder pt 20 → suggest 100 @ 4,500).

## Next (management visibility, slice B)
**Reports**: inventory valuation (by warehouse / category), low-stock & out-of-stock, and inventory
aging, with an Analytics/Reports UI. Stock card and movement reports already exist as inventory queries.
