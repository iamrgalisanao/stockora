# Phase 20 — Reports (management visibility, slice B)

**Status: ✅ Complete.** Computed read-models over the current balances/ledger + WAC (no new tables).

## Endpoints
- `GET /api/reports/valuation?groupBy=warehouse|category|brand` — inventory value
  (`Σ on_hand × avg_cost`) grouped and totalled. Gated by `valuation.view`.
- `GET /api/reports/stock-status?status=OUT|LOW|OVERSTOCK|OK` — per-product on-hand/available vs
  reorder point & max stock, classified (OUT ≤0, LOW ≤ reorder point, OVERSTOCK > max, else OK).
  Optional status filter. Gated by `report.view`.
- `GET /api/reports/dead-stock?days=N` — products holding stock whose last **outbound** movement is
  older than N days (or never issued), with idle-days and value (value gated by `valuation.view`).
  Gated by `report.view`.

All are warehouse-scope aware.

## Web UI (Analytics nav group)
- **Valuation** — total value + rows, with a By warehouse / category / brand toggle.
- **Stock Status** — table with an ALL/OUT/LOW/OVERSTOCK/OK filter and status badges.
- **Dead Stock** — table with a 30/60/90/180-day window selector.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **56 e2e** ✅ (3 new report
  tests: valuation by warehouse=6000 and by category Storage:1000/Uncategorized:5000 + invalid groupBy
  400; stock-status classification + filter; dead-stock never-issued with value).
- Read-only report pages reuse the table pattern already verified live in earlier slices; covered by e2e.

## Aging note
True receipt-date **aging buckets** need per-lot/layer receipt dates, which the WAC MVP doesn't retain
(`cost_layers` exists but isn't populated under weighted-average). Deferred to the FIFO/cost-layer work;
**Dead Stock** (movement-recency based) covers the "stagnant inventory" need accurately in the meantime.

## Management-visibility area complete
Slice A (reorder + dashboard) + Slice B (reports) done. The platform now turns the ledger into
decisions: exception-first dashboard, reorder suggestions, valuation, stock status, and dead stock.
