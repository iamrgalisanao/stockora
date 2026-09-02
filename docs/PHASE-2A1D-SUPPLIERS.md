# Phase 2A.1D — Suppliers & Supplier Catalog (backend + UI)

**Status: ✅ Complete.** Fourth 2A slice. Brings suppliers and their product catalog up to the same
operational-readiness bar as the rest of master data: the **`EntityStatus` lifecycle** (replacing the
legacy `isActive` boolean), audit on every mutation, list search + status filter, a status-transition
endpoint, and a **`CanArchiveSupplier`** guard. Rules per
[ADR 0003](adr/0003-master-data-vs-ledger.md).

## Backend
- **Lifecycle:** `Supplier` and `SupplierProduct` now use `EntityStatus` (ACTIVE/INACTIVE/ARCHIVED).
  A data-preserving migration adds the status columns, backfills `INACTIVE` where `is_active = false`,
  then drops `is_active` and swaps the index.
- **`CanArchiveSupplier`** blocks ARCHIVE while the supplier is the `preferredSupplierId` on any
  non-archived **Product** or **InventoryPolicy**, or is referenced by an **open goods receipt**
  (DRAFT/RECEIVING/FOR_INSPECTION/PARTIALLY_RECEIVED). Deactivation (INACTIVE) is always allowed.
- **Audit:** `supplier.created/updated/status_changed` and
  `supplier_product.linked/updated/status_changed` — all via the shared audit log, readable at
  `GET /api/audit?entityType=supplier&entityId=…`.
- **List:** `GET /api/suppliers?q=&status=` — case-insensitive search on code/company, status filter.
- **Endpoints:** `POST /suppliers/:id/status`, `POST /suppliers/:id/products/:spId/status` join the
  existing CRUD. Supplier-product links are now archived (reversible), never hard-deleted.
- `SupplierProduct.cost` stays gated by `cost.view`.

## Web UI
- **Suppliers list** — search box + status filter + `StatusBadge`, links to the editor, New supplier.
- **New supplier** form (code, company, contact, lead time, terms, rating, preferred-vendor flag).
- **Supplier editor** with tabs **General / Catalog / History**:
  - *General* — edit descriptive fields; Activate/Deactivate/Archive from the toolbar.
  - *Catalog* — link products (supplier SKU, cost, MOQ), inline **Edit**, and per-link lifecycle.
  - *History* — the supplier's audit trail.
- Nav: **Catalog → Suppliers**.

## Contract changes
`SupplierResponse.status` and `SupplierProductResponse.status` replace `isActive` (EntityStatus).

## Tests
- **e2e** (`suppliers.e2e-spec.ts`): create→ACTIVE + audit, search + status filter, duplicate-code `409`,
  catalog link/duplicate-`409`/update/lifecycle + audit, and the archive guard — blocked by a preferred
  product, a preferred policy, and an open receipt; allowed for an unreferenced supplier, which then
  refuses reactivation from ARCHIVED. 23 unit + 79 e2e green.

## Notes / deferred
- `isPreferred` on the supplier is a descriptive "preferred vendor" tag; the authoritative preference is
  the `preferredSupplierId` link on products/policies (2A.1C).
- Supplier analytics / scorecards remain in **2D** (procurement intelligence).
