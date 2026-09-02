# Phase 2A.1C — Inventory Policies & Reorder Engine (backend + UI)

**Status: ✅ Complete.** Third 2A slice. Reorder configuration moves off the `Product` (org-wide) and
onto a warehouse-scoped **`InventoryPolicy`** aggregate, and a single **`ReorderAssessmentService`**
becomes the one authoritative place that turns *policy + current availability* into a reorder
recommendation. Rules per [ADR 0002 §2A.1C](adr/0002-phase-2-architecture.md) and
[ADR 0003](adr/0003-master-data-vs-ledger.md).

## Why the move
Stock-maintenance thresholds are a **per-warehouse** decision, not a global product attribute — the
same SKU can be a fast-mover in one DC and dead weight in another. The old `Product.minStock/maxStock/
reorderPoint/reorderQty` columns are removed; `leadTimeDays` stays on the product.

## The aggregate
`InventoryPolicy` — one **ACTIVE** policy per `(organization, warehouse, product, variant)` (the
NIL-UUID sentinel means "product-level, no variant"), enforced by a unique key.

- **Fields:** `minStock ≥ 0`, `maxStock?` (nullable), `reorderPoint ≥ 0`, `reorderQuantity > 0`,
  `preferredSupplierId?`, `status` (EntityStatus).
- **Validation:** `reorderQuantity > 0`; when `maxStock` is set it must be `≥ minStock` **and**
  `≥ reorderPoint`. We deliberately do **not** force `minStock ≤ reorderPoint` — an inverted config is
  legal and produces the `LOW_STOCK` band (see below).
- **Lifecycle:** ACTIVE ⇄ INACTIVE, ACTIVE/INACTIVE → ARCHIVED (shared `assertStatusTransition`).
  Status changes are tracked via `statusChangedAt` + the audit log (attribution lives in the entry).
- The policy **owns no purchasing logic** — it holds thresholds and a preferred supplier, nothing more.

## The authoritative calculation (`ReorderAssessmentService`)
`available = onHand − reserved − quarantined`. **`inTransit` is surfaced but never counted** into
availability; it only softens a shortfall into `INBOUND_COVERED`. Only ACTIVE policies on ACTIVE
products/variants in ACTIVE warehouses are assessed.

State precedence (first match wins):

| State | Condition |
|---|---|
| `OUT_OF_STOCK` | `available ≤ 0` |
| `REORDER_REQUIRED` | `available ≤ reorderPoint` and inbound does **not** cover the gap |
| `INBOUND_COVERED` | `available ≤ reorderPoint` but `available + inTransit > reorderPoint` |
| `LOW_STOCK` | `available ≤ minStock` (only reachable when `minStock > reorderPoint`) |
| `OVERSTOCK` | `maxStock` set and `onHand > maxStock` |
| `OK` | otherwise |

`recommendedQuantity = reorderQuantity` **only** when the state is `REORDER_REQUIRED` (else `0`).
`estimatedCost = recommendedQuantity × unit cost` (preferred-supplier price when available, else
product cost) — gated by `cost.view`.

### One calculation, three read paths
- `GET /api/reorder/recommendations` → `ReorderAssessment[]` filtered to `REORDER_REQUIRED`, most urgent first.
- `GET /api/reports/stock-status?state=` → the full assessment, optionally filtered by state, worst-first.
- `GET /api/dashboard/summary` → `reorderCount / lowStockCount / outOfStockCount` derived from the same
  assessment (the dashboard read path never touches the policy editor).

## Endpoints
- `GET  /api/products/:productId/policies` — list a product's policies across (scoped) warehouses.
- `POST /api/products/:productId/policies` — create (validated, audited).
- `PATCH /api/inventory-policies/:id` — update thresholds/supplier (validated, audited).
- `POST /api/inventory-policies/:id/status` — lifecycle transition (audited).

Reads require `inventory.view`; mutations require `product.manage`; all warehouse-scoped.

## Web UI
- **Product editor** gains an **Inventory Policies** tab: a per-warehouse table (Min / Reorder pt /
  Reorder qty / Max / Supplier / Status) with inline **Edit** and Activate/Deactivate/Archive, plus a
  create row (warehouse, product-or-variant, thresholds, preferred supplier).
- **Reorder Recommendations** and **Stock Status** pages now render the warehouse+variant assessment
  (On hand / Available / In transit / Reorder pt / Recommended / state), with state filters.

## Migration (data-preserving)
`20260902060000_inventory_policies` creates `inventory_policies`, **backfills** a policy per product
that had `reorder_point > 0` (one per warehouse holding a balance, plus a default-warehouse fallback),
then drops the four `Product` reorder columns.

## Tests
- **Unit** (`reorder-assessment.service.spec.ts`): availability formula (reserved & quarantined
  subtracted, in-transit not), every state incl. `INBOUND_COVERED` and the `LOW_STOCK` band,
  `recommendedQuantity`, supplier-priced `estimatedCost` + `cost.view` gating, inactive-variant drop,
  dashboard rollup.
- **e2e** (`inventory-policies.e2e-spec.ts`): threshold validation, variant-belongs-to-product,
  duplicate-policy `409`, in-transit `INBOUND_COVERED` via a real transfer dispatch, INACTIVE policy
  ignored, non-ACTIVE product excluded, create/update audited. Analytics & reports e2e reworked onto
  policies.

> Reserved/quarantined stock has no public write path yet (that arrives in **2B**), so those
> availability effects are proven at the unit level with crafted balances rather than over HTTP.
