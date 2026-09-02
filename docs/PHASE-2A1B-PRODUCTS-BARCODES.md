# Phase 2A.1B — Products, Variants & Barcodes (backend + UI)

**Status: ✅ Complete.** Second 2A slice. Products/variants become lifecycle-aware, a real
multi-barcode subsystem replaces the single `barcode` field, and a `BarcodeResolver` provides the
scanner foundation. Rules per [ADR 0003](adr/0003-master-data-vs-ledger.md).

## Backend
- **Lifecycle:** `Product` and `ProductVariant` now use `EntityStatus` (migration drops `isActive` +
  the legacy `barcode` columns, backfilling status and moving barcodes into `product_barcodes`).
  - Product can be **ACTIVE only if it has no variants or ≥ 1 ACTIVE variant** (checked at activation;
    never cascaded from a variant change).
  - **`CanArchiveProduct`**: blocks archive while any bucket (on_hand/reserved/in_transit/quarantined/
    damaged) is non-zero **or** an open receipt/release/transfer/adjustment/count references it.
  - **Edit guards:** `baseUomId`, `isSerialized`, `isBatchTracked` are immutable once any inventory
    movement exists; descriptive fields stay editable.
- **`ProductBarcode`** (catalog/identity, never the ledger): belongs to a product + optional variant;
  code unique per org; one PRIMARY per (product, variant) scope; `barcodeType` STANDARD/INTERNAL.
- **`BarcodeResolver`** — `GET /api/resolve?code=` → `{ type: PRODUCT | PRODUCT_VARIANT, entityId,
  productId, variantId, displayCode, status, metadata }`. Resolves **identity, not availability**;
  inactive/archived barcodes, variants, and products do not resolve. Contract is intentionally broad
  for future LOT/SERIAL/LOCATION/DOCUMENT.
- Endpoints: product status + variant status transitions, variant CRUD, and
  `/products/:id/barcodes` (list/assign/update/delete). All mutations audited.

## Web UI
- Products list: status filter + `StatusBadge`, links to the editor, New product.
- **New product** form (General fields).
- **Product editor** with tabs **General / Variants / Barcodes / History** — edit descriptive fields,
  Activate/Deactivate/Archive, manage variants (add + lifecycle), manage barcodes (assign, set primary,
  deactivate, delete), and view audit history. Reorder config intentionally deferred to 2A.1C.

## Verified
- api + web build (dev + prod) ✅, turbo typecheck 4/4 ✅, 13 unit ✅, **65 e2e** ✅ (6 new invariant
  tests: duplicate-barcode rejected, one-primary-per-scope, archived/inactive-variant don't resolve,
  archive blocked with stock / allowed without, base-unit & tracking-flag freeze after movements,
  variant lifecycle doesn't archive the parent + active-variant-required-to-activate).
- Live browser: product editor tabs render; barcode assigned + resolves (`4801234567890` → Samsung 1TB SSD).

## Next
**2A.1C — Inventory policies**: warehouse-level `InventoryPolicy` (min/max/reorder point/qty, preferred
supplier); reorder engine + dashboard switch from product-level fields to policy. Then 2A.1D suppliers,
2A.1E warehouses/locations, 2A.1F audit explorer.
