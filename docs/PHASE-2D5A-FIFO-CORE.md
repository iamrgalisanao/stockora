# Phase 2D.5A — FIFO Core

**Status: ✅ Complete.** First slice of 2D.5 ([ADR 0013](adr/0013-fifo-costing.md)). FIFO valuation via
persistent, immutable **cost layers** alongside the existing WAC path — quantity stays ledger-authoritative;
cost is a strategy over the same physical movements.

## Model

- **`CostLayer`** — one immutable purchase-cost layer per (org, product, variant, warehouse), opened by an
  inflow movement (`sourceMovementId`, `receivedQuantity`, `remainingQuantity`, `unitCost`, `receivedAt`,
  `OPEN|DEPLETED`). Not per lot — a lot may span layers.
- **`CostLayerConsumption`** — an immutable record of an outbound movement consuming part of a layer
  (`outboundMovementId`, `quantity`, `unitCost`, `extendedCost`).
- **`CostingPolicy`** — strategy selection: `productId = NIL` is the org default; per-product overrides sit
  above it. `strategyFor` = product → org-default → **WAC** (the unchanged default).

## Costing rides `applyMovement`

The strategy hook runs where the movement is written, inside the same transaction, so value and quantity
commit atomically and inherit the ledger's idempotency (a replayed post short-circuits before any layer is
touched — no double consumption). WAC's `avgCost` is still maintained for every movement (kept for reporting
and authoritative for WAC products).

- **Inflow that opens basis** (`OPENING_BALANCE`, `PURCHASE_RECEIPT`) under FIFO → **open a cost layer** at the
  received unit cost.
- **Outflow that expenses value** (`SALES_RELEASE`, in 2D.5A) under FIFO → **consume layers oldest-first**
  (`received_at ASC, id ASC`) under `FOR UPDATE` locks, set the movement's `unitCost`/`totalCost` to the
  consumed COGS, and write the consumption records. Insufficient layer quantity **fails safely**.

Transfers, returns, adjustments, damage/dispose, and counts are intentionally **not** layer-touching in 2D.5A
(2D.5B), so their WAC behavior is unchanged.

## Strategy switch guard

Changing strategy for a scope is rejected while on-hand ≠ 0 (ADR 0013 §3) — no flipping WAC→FIFO mid-stock and
pretending historical layers exist. A real revaluation workflow is deferred.

## API (cost figures `cost.view`/`valuation.view`-gated)

- `GET/POST /inventory/costing-policy` — read / set strategy (`settings.manage` to set).
- `GET /inventory/cost-layers` — open/depleted layers (`cost.view`).
- `GET /inventory/cost-valuation` — per-scope WAC-vs-FIFO valuation (`valuation.view`).
- `GET /inventory/movements/:id/cost-layers` — the consumption records behind a movement's cost (`cost.view`).

## UI

A **Costing** page: the org strategy control (WAC/FIFO, guarded), a WAC-vs-FIFO valuation table with totals,
and an inline cost-layer drill-down per product (oldest-first, remaining × unit cost). Rich reporting is 2D.5C.

## Tests

`test/fifo-costing.e2e-spec.ts` (6): a receipt opens one layer / multiple receipts open independent layers;
FIFO consumes oldest-first, spans layers (10@100 + 5@110 = 1550), and remaining reconciles to on-hand; FIFO
valuation equals Σ remaining-layer value (15 × 110 = 1650); a replayed release doesn't duplicate consumption
and over-release fails safely; the WAC path is unchanged for WAC products (no layers, WAC average cost); a
strategy switch is blocked while stock exists and cost figures are permission-gated. Full suite green
(52 suites / 372 tests) — the per-movement strategy hook left every WAC flow intact. Browser-verified the
Costing page (WAC ₱1,600 vs FIFO ₱1,650 on a two-layer product).

## Definition of done (2D.5A)

> For FIFO-configured inventory, every outbound quantity consumes an immutable, deterministic sequence of
> historical cost layers, while physical inventory remains governed by the existing ledger and the WAC path
> is unchanged. ✅

**Next:** 2D.5B — Propagation (transfers preserve cost basis, returns restore original basis, adjustments,
damage/disposal, counts, strategy-migration/revaluation guards).
