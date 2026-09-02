# ADR 0002 — Phase 2 Architecture Decisions

**Status:** Accepted · **Date:** 2026-09-02

Phase 2 is a **product-hardening / operational-readiness phase first**, then advanced inventory.
Decisions below govern how the Phase 2 backlog is built (see [PHASE-2-PLAN.md](../PHASE-2-PLAN.md)).

## Cross-cutting
- **Modular monolith organized by domain** (Inventory, Catalog, Warehouse, Approvals, Counting,
  Costing, Returns, Reservations, Identity, Notifications, Reporting…). No microservices, no full CQRS.
- **Conceptual command/query separation** adopted for new/expanded domains:
  `domain/` · `application/{commands,queries}/` · `infrastructure/repositories/`. Applied going
  forward and incrementally — not a big-bang refactor of existing modules.
- **Optional capabilities are configuration, not forks:** batch/lot, expiry/FEFO, serial, and
  reservations are toggled per-org / per-product so retail, distribution, computer shops, restaurants,
  construction, and light manufacturing all run the same core.

## Master data (2A)
One consistent pattern for every entity: **List → Search/Filter → Create/Edit → Validation → Archive
→ Audit history.** Lifecycle statuses **ACTIVE / INACTIVE / ARCHIVED**; **archive/deactivate, never
physically delete** records referenced by ledger movements.

## Barcode / global search (2A) — build early, it's infrastructure
A dedicated **`BarcodeResolver`** (not queries embedded per feature):
`GET /api/resolve?code=<code>` → `{ type, id, … }` resolving PRODUCT / VARIANT / BATCH / SERIAL /
LOCATION / DOCUMENT, and EAN-13 / UPC / QR / internal / lot / serial / bin codes. Reused later by
receiving, picking, transfers, counts, returns, serial, and mobile. A global search box sits on top.

## Reservations (2B) — model as an aggregate, not `reserved += X`
`InventoryReservation` (reservation_no, source_type, source_id, warehouse_id, status, expires_at) +
lines (product_variant, location, quantity, batch?, serial?). States: DRAFT · RESERVED ·
PARTIALLY_CONSUMED · CONSUMED · RELEASED · EXPIRED · CANCELLED. `ReserveStock` validates
`requested ≤ available` inside the existing balance transaction/lock. Sources now: Manual / Internal
Request / External Reference; later Sales Order / E-commerce / CRM / Production become additional sources.
A Release consumes a reservation.

## Returns + disposition (2B) — separate receipt from disposition
A return does **not** auto-restock. `Return` → `ReturnLine` → `ReturnInspection` → `Disposition`
(RESTOCK / QUARANTINE / DAMAGED / REPAIR / RETURN_TO_SUPPLIER / SCRAP / DISPOSE). Ledger records the
consequence, e.g. `CUSTOMER_RETURN +5 → QUARANTINE`, then inspection splits
`QUARANTINE −3 / AVAILABLE +3` and `QUARANTINE −2 / DAMAGED +2`. Never mutate historical movements.

## Inventory status / position — formalize condition
Conditions AVAILABLE / RESERVED / QUARANTINED / DAMAGED / IN_TRANSIT. Evolve toward an explicit
`InventoryPosition(product, warehouse, location, lot?, status) → quantity` with explicit state
transitions (AVAILABLE→RESERVED, QUARANTINED→AVAILABLE/DAMAGED, …). **Adoption is incremental:** keep
the current bucket columns through 2A/2B; introduce the lot + position dimension in **2C** when batch
lands (that's the migration that needs it), so we don't disrupt a proven balance table prematurely.

## Batch/Lot (2C)
Real aggregate `InventoryLot` (product_variant, lot_number, mfg/expiry/received dates, supplier?,
status, attributes). Balance uniqueness gains `lot` + `inventory_status`; `lot_id = null` for
non-batch. The ledger stays generic — lot is **metadata on movement lines**, not a separate ledger.

## Allocation (2C) — FEFO is a policy, not hardcoded in Release
`StockAllocationStrategy` with ManualAllocation / FIFOAllocation / FEFOAllocation (later
LIFO / NearestLocation / PickFaceFirst). FEFO = eligible lots ordered by expiry ASC, then received ASC.
**Expired (expiry < today) cannot allocate to a normal release** without an explicit override permission.

## Cycle counting (2C) — schedule above Physical Count
Reuse `PhysicalCount(type=CYCLE)`; add `CycleCountPolicy` / `CycleCountSchedule` / `CycleCountTask`
(A=30d, B=90d, C=180d). Manual ABC classes first; value/velocity/variance-driven later.

## Inventory policies & reorder assessment (2A.1C)
- **`InventoryPolicy`** answers "what stock level should this warehouse maintain for this variant?" —
  key `(org, warehouse, product, variantId)` (NIL-uuid sentinel = product-level, matching the balance
  table); fields `minStock`, `maxStock?`, `reorderPoint`, `reorderQuantity`, `preferredSupplierId?`,
  `status`. **One row per key**; `status` enables/disables it. Validation: `minStock ≥ 0`,
  `reorderPoint ≥ 0`, `reorderQuantity > 0`; if `maxStock` set then `≥ minStock` and `≥ reorderPoint`.
  `minStock ≤ reorderPoint` is **not** enforced (independent reporting vs trigger thresholds).
  It owns **no** purchasing logic (no PO/lead-time/MOQ/pack/pricing/approvals).
- The product-level reorder fields (min/max/reorderPoint/reorderQty) are **removed** and migrated into
  policies (one per warehouse where the product has a balance; else the org's default warehouse).
- **`ReorderAssessmentService`** is the single authoritative calc used by the reorder API, dashboard,
  and stock-status report: `available = on_hand − reserved − quarantined` (never counts `in_transit`,
  but surfaces it). Derived state: `OK | LOW_STOCK | REORDER_REQUIRED | INBOUND_COVERED | OVERSTOCK`
  (OVERSTOCK when maxStock set & on_hand > maxStock; REORDER_REQUIRED when available ≤ reorderPoint and
  available + in_transit ≤ reorderPoint; INBOUND_COVERED when inbound covers the shortfall; LOW_STOCK
  when available ≤ minStock but above the reorder trigger). `recommendedQuantity = reorderQuantity`
  (deterministic; maxStock-topup is a documented future option). Emits a `ReorderAssessment` result
  object today; events (ReorderRequired/LowStockDetected/…) come with the outbox work.

## Import / Export (2A, moved earlier)
`ImportJob` / `ImportRow` / `ImportError`; pipeline **Upload → Parse → Validate → Preview → Resolve →
Commit → Report**. Never write while parsing; per-row VALID / INVALID / WARNING; jobs idempotent /
protected against accidental re-upload.

## Domain events + transactional outbox (2D, before notifications)
`BEGIN; write ledger; update balance; write outbox event; COMMIT;` then a background processor fans out
to Notifications / Integrations / Analytics / Webhooks / (later) AI. Events: StockReceived, StockReleased,
StockTransferred, StockAdjusted, StockReserved, ReservationReleased, ReturnReceived, InventoryQuarantined,
LowStockDetected, LotExpiring, PhysicalCountVarianceDetected, ApprovalRequested, ApprovalCompleted.

## Costing (2D) — stay WAC unless a customer needs FIFO
`CostingStrategy` interface; implement **WeightedAverageCost only** now. FIFO/SpecificIdentification
(with cost layers, layer allocation/reversal, backdated corrections) added only when commercially
justified. True receipt-date **aging** depends on this.

## Serial (2D, after batch)
`InventorySerial` (serial_number, product_variant, warehouse, location, lot?, status,
last_movement_id). Invariant #5: exactly one active position, enforced in **DB + application**.

## Mobile warehouse (2D) — task-oriented, not responsive desktop
A scanner-first PWA (SCAN RECEIVE / PICK / COUNT flows) that invokes the same backend commands; never
shrink desktop document screens onto a phone.

## Milestone definition of "Phase 2 done enough to deploy"
> A business can onboard its own inventory, warehouses, suppliers and opening balances, locate any item
> by search or barcode, reliably reserve and return inventory, and operate the complete system without
> developer intervention.
