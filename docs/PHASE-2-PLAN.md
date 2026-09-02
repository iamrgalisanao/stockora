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

## Delivery method
Continue **thin vertical slices** (backend + UI + tests, verified, committed) per backlog item, each
respecting the invariants (ADR 0001). Build order follows the table above.
