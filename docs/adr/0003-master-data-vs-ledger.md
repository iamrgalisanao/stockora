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

## Application-command shape (no formal bus)
Master-data mutations are expressed as identifiable, testable business actions — `CreateProduct`,
`UpdateProduct`, `ChangeProductStatus`, `AssignBarcode`, `AddVariant`, `UpdateInventoryPolicy` — not raw
ORM saves. Fits the incremental command/query separation (ADR 0002).
