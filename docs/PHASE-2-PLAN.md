# Phase 2 Plan — Operational Readiness → Advanced Inventory

**Framing:** the transactional engine is ahead of the UX. Phase 2 closes the product-readiness gap
first, then adds advanced inventory. Architecture decisions: [adr/0002-phase-2-architecture.md](adr/0002-phase-2-architecture.md).
Invariants: [adr/0001-inventory-invariants.md](adr/0001-inventory-invariants.md).

## Increments

| Increment | Focus | Main capabilities |
|---|---|---|
| **2A — Operational Readiness** | Deployable to real customers | Master-data UIs, barcode/global-search resolver, audit viewer, CSV import/export, security hardening |
| **2B — Stock Commitment & Reverse Logistics** | Complete the lifecycle | Reservations (aggregate), Returns + disposition + quarantine |
| **2C — Traceability** | Regulated / perishable | Batch/lot, expiry + FEFO (allocation policy), cycle-count scheduler, inventory-position model |
| **2D — Intelligence & Scale** | Automation & optimization | Events/outbox, notifications, serial tracking, supplier analytics, FIFO costing, mobile scanner PWA |

## Ordered backlog

| Order | Capability | Increment | Reason |
|---|---|---|---|
| 1 | Master-data management UI | 2A | Customer self-service |
| 2 | Global search + barcode resolver | 2A | Foundation for every scanner workflow |
| 3 | CSV import / export | 2A | Real customer onboarding |
| 4 | Audit-log viewer | 2A | Accountability |
| 5 | Security hardening (ESLint, refresh tokens, rate limiting) | 2A | Production readiness |
| 6 | Reservations | 2B | Prevent overselling |
| 7 | Returns + disposition | 2B | Complete stock lifecycle |
| 8 | Domain events + outbox | 2B/2D | Integration/automation foundation |
| 9 | Batch/lot tracking | 2C | Traceability |
| 10 | Expiry + FEFO | 2C | Builds on lots |
| 11 | Cycle-count scheduler | 2C | Warehouse accuracy |
| 12 | Notifications | 2D | Powered by events |
| 13 | Mobile / scanner warehouse UI | 2D | Operational speed |
| 14 | Serial tracking | 2D | Electronics/assets |
| 15 | Supplier analytics | 2D | Procurement intelligence |
| 16 | FIFO costing | 2D | Only when commercially justified |

## Current gaps this closes (from MVP review)
- Master data (products/categories/units/brands/suppliers/warehouses/locations) is API/seed-only → 2A #1.
- No barcode lookup / global search → 2A #2.
- No bulk onboarding → 2A #3.
- Audit captured but not browsable → 2A #4.

## 2A locked breakdown (accepted 2026-09-02)
- **2A.1A — Catalog foundations:** Categories, Brands, Units + conversions; the `EntityStatus`
  lifecycle model; reusable master-data UI patterns (table, search/filter, status badge, create/edit
  form, archive action, entity audit-history drawer) + a generic per-entity audit endpoint.
- **2A.1B — Products + variants:** application commands; `ProductBarcode` (multi-barcode per variant);
  `BarcodeResolver` v1 (PRODUCT, PRODUCT_VARIANT); archive/status rules (block archive while on-hand > 0).
- **2A.1C — Inventory policies:** warehouse-level `InventoryPolicy` (min/max/reorder point/qty,
  preferred supplier); reorder engine + dashboard switch from product-level fields to policy.
- **2A.1D — Suppliers + supplier-products.**  · **2A.1E — Warehouses + hierarchical locations.**
- **2A.1F — Audit explorer** (org-wide search over the same audit data).
- **2A.2 — Global search + barcode scanner UX** (BarcodeResolver v2+: LOT, SERIAL, LOCATION, DOCUMENT).
- **2A.3 — Import/export framework.**  · **2A.4 — Production/security hardening.**

**2A.1 Definition of Done:** a new org can build its sellable catalog (category → units → brand →
product → variants → barcode → warehouse reorder policy), edit/deactivate/reactivate/archive it,
search/filter it, and see who changed it — entirely through the web app, respecting RBAC, org/warehouse
boundaries, audit, validation, uniqueness, concurrency, and referential integrity. No seeds/API/dev help.

## Delivery method
Continue **thin vertical slices** (backend + UI + tests, verified, committed) per backlog item, each
respecting the invariants (ADR 0001). Build order follows the table above.
