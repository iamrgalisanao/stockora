# ADR 0003 — Master data describes; the ledger records

**Status:** Accepted · **Date:** 2026-09-02

> **Master data describes what *may* participate in inventory operations; the ledger records what
> *actually* happened. Master-data lifecycle changes must never alter historical inventory transactions.**

Consequences:
- Renaming a SKU, changing a product's unit, deactivating a supplier, or archiving a warehouse
  **never** rewrites, reprices, or deletes posted movements. History is immutable (ADR 0001 #1).
- Master data uses a **3-state lifecycle** `status` (see below); records referenced by history are
  **archived/deactivated, never physically deleted**.
- Reports over history remain valid even after the referenced master data is archived.

## Lifecycle status model (replaces `isActive` on master entities)
`EntityStatus`: **ACTIVE** (operational, appears in selectors, usable in new transactions) ·
**INACTIVE** (temporarily hidden from selectors, reactivatable, history intact) · **ARCHIVED** (retired,
hidden from operational workflows, history valid, not reactivatable via normal UI).

- `status` is the single authoritative lifecycle field. Do **not** keep `isActive` alongside it.
  Metadata only: `statusChangedAt`, `archivedAt?`, `archivedById?`.
- Migration: `isActive=true → ACTIVE`, `isActive=false → INACTIVE`, then drop `isActive` (per entity as
  its management UI is built).
- Transitions: `ACTIVE ⇄ INACTIVE`, `ACTIVE/INACTIVE → ARCHIVED`. `ARCHIVED → ACTIVE` is a **privileged,
  audited restore**, not a normal edit.
- **Product archive rule (Phase 2):** allow INACTIVE with stock/history; **block ARCHIVE while on-hand > 0**
  and while referenced by open reservations/receipts/releases/transfers. Operational eligibility ≠ inventory existence.

## Products, variants & barcodes (2A.1B)
- **Product & variant are lifecycle-aware** (EntityStatus). A product may be **ACTIVE only if it either
  has no variants or has ≥ 1 ACTIVE variant** (enforced at product activation, never cascaded from a
  variant change). Variants deactivate independently.
- **`ProductBarcode`** (catalog/identity domain, **never** the ledger): belongs to a Product with an
  **optional** `variantId` (null = product-level barcode for a variant-less product). Invariants:
  code is **globally unique per org**; many barcodes per identity; **one PRIMARY per (product,
  variant-or-null)** scope; **archived/inactive barcodes and inactive variants/products do not resolve**;
  historical movements never depend on the current barcode value. `barcodeType`: STANDARD / INTERNAL
  (no EAN/UPC/case-pack semantics yet). Concurrency: DB unique `(org, code)`.
- **`BarcodeResolver` resolves identity, not availability:** `resolve(code, context?) → { type
  (PRODUCT | PRODUCT_VARIANT | later LOT/SERIAL/LOCATION/DOCUMENT), entityId, productId, variantId,
  displayCode, status, metadata }`. Inventory availability is a separate query.
- **Edit guards** — once **any inventory movement exists** for a product, `baseUomId`, `isSerialized`,
  and `isBatchTracked` are **immutable** (Phase 2A blocks the change outright). Descriptive fields
  (name, description, category, brand, image, tax) stay editable.
- **`CanArchiveProduct`** blocks ARCHIVE while any bucket (on_hand/reserved/in_transit/quarantined/
  damaged) is non-zero **or** an open operational document references the product; distinguishes
  operational eligibility from inventory existence.

## Suppliers & supplier catalog (2A.1D)
- **`Supplier` and `SupplierProduct` are lifecycle-aware** (EntityStatus), replacing the legacy
  `isActive` boolean — same ACTIVE ⇄ INACTIVE, ACTIVE/INACTIVE → ARCHIVED rules, all mutations audited.
- **`CanArchiveSupplier`** blocks ARCHIVE while the supplier is still relied upon: it is the
  `preferredSupplierId` on any non-archived Product **or** InventoryPolicy, or is referenced by an
  **open goods receipt** (DRAFT/RECEIVING/FOR_INSPECTION/PARTIALLY_RECEIVED). Deactivation is always
  allowed. `Supplier.isPreferred` is a **descriptive classification only** — surfaced in the UI as
  "Preferred Vendor (strategic classification)" — and must never be read as procurement selection.
  The **operational source of truth** for which supplier a product/warehouse reorders from is the
  `preferredSupplierId` link on the Product and the InventoryPolicy; the two concepts are kept
  deliberately separate so a strategic-vendor label can never silently drive a reorder.
- **`SupplierProduct`** is the supplier's catalog offer (supplier SKU, negotiated cost, MOQ, lead time);
  cost is gated by `cost.view`. One offer per `(org, supplier, product)`. Archiving a link is
  reversible via status; it is not a hard delete (history-preserving).

## Warehouses & location hierarchy (2A.1E)
- **`Warehouse` and `WarehouseLocation` are lifecycle-aware** (EntityStatus, replacing the old
  `WarehouseStatus` enum / `is_active` boolean). Deactivation is permissive; archiving is guarded, and
  every lifecycle/hierarchy mutation is audited.
- **`CanArchiveWarehouse`** (the reusable "operational eligibility ≠ existence" pattern from
  `CanArchiveProduct`) blocks ARCHIVE while ANY stock bucket is non-zero
  (on_hand/reserved/in_transit/quarantined/damaged — never `on_hand = 0` alone), an open
  receipt/release/transfer/adjustment/count exists, an ACTIVE inventory policy targets it, or an active
  child location remains.
- **`CanArchiveLocation`** blocks ARCHIVE while any inventory movement references the location (its
  stock/history proxy — balances are not location-scoped yet), an open document line references it, or
  it has active descendants.
- **Generic location tree, not a fixed sequence.** A location has `warehouseId`, optional
  `parentLocationId`, `code`, `name`, free-form structural `type` (ZONE/AISLE/RACK/… — suggested, not
  enforced), and an operational `usage` classification (STORAGE/RECEIVING/STAGING/QUARANTINE/DAMAGED/
  DISPATCH/OTHER — validation metadata, **not** a balance bucket). A small warehouse may be one root
  shelf; a large one, four levels.
- **Hierarchy invariants:** `code` is unique per `(organization, warehouse)` — the same `BIN-01` may
  exist in many warehouses. A location belongs to exactly one warehouse; `warehouseId` is **immutable**.
  Moves reparent **within the same warehouse only** (a dedicated Move action), are cycle-safe
  (no self-parent, no ancestor cycle), and never cross warehouses — so descendants can never span
  warehouses even after inventory movements exist.
- **Historical resolution:** archived/inactive warehouses and locations are excluded from **new**
  operational selection (`assertSelectableForCreate` / `assertLocationSelectable` gate the create paths
  of receiving/releases/transfers/adjustments/counts), but they are never deleted and continue to
  resolve in historical documents, reports, and direct reads.

## Application-command shape (no formal bus)
Master-data mutations are expressed as identifiable, testable business actions — `CreateProduct`,
`UpdateProduct`, `ChangeProductStatus`, `AssignBarcode`, `AddVariant`, `UpdateInventoryPolicy` — not raw
ORM saves. Fits the incremental command/query separation (ADR 0002).
