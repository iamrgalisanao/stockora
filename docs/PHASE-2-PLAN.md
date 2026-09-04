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
| **2D — Intelligence & Scale** | Automation & optimization | Events/outbox, notifications, serial tracking, supplier analytics, FIFO costing, mobile scanner PWA with offline command journal |

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
| 13 | Serial tracking | 2D | Electronics/assets |
| 14 | Supplier analytics | 2D | Procurement intelligence |
| 15 | FIFO costing | 2D | Commercially justified; now complete |
| 16 | Mobile scanner PWA | 2D | Final Phase 2D item; operational speed under unreliable connectivity; see ADR 0014 |

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

## 2D.6 locked breakdown (accepted 2026-09-04)

Architecture: [ADR 0014 - Mobile Scanner PWA and Offline Command Journal](adr/0014-mobile-scanner-pwa.md).
Phase plan: [PHASE-2D6-MOBILE-SCANNER-PWA.md](PHASE-2D6-MOBILE-SCANNER-PWA.md).

- **2D.6A - PWA + Device Foundation:** manifest/installability, Workbox/service worker, offline shell,
  IndexedDB, persistent-storage request, device installation ID, connectivity state, service-worker update UX,
  Web Locks sync mutex, BroadcastChannel coordination, scanner abstraction, and wake-lock enhancement.
- **2D.6B - Mobile Workflows:** scanner-first receive, pick/release, transfer, cycle count, and return flows;
  offline worklist snapshots; shared barcode/lot/serial controls; task claiming.
- **2D.6C - Offline Command + Conflict Engine:** `PendingCommand`, idempotency keys, dependency ordering,
  manual/reconnect/background-enhanced sync, server revalidation, conflict contract/inbox, command receipts, and
  optimistic aggregate versions.
- **2D.6D - Resilience + Operational Hardening:** offline authorization window, logout/local wipe, IndexedDB
  migrations, command schema compatibility, service-worker update safety, storage eviction handling,
  multi-device race tests, network interruption tests, sync telemetry, and compatibility matrix.

**2D.6 Definition of Done:** warehouse operators can use an installable scanner-first mobile PWA to capture
authorized work during unreliable connectivity, synchronize intent exactly once when the server is reachable,
resolve explicit conflicts without silent merges, and preserve all inventory, serial, lot, reservation, FEFO,
and FIFO invariants under multi-device concurrency.
