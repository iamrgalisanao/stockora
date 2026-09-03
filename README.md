# Inventory + Warehouse Management System

An **Inventory Control Engine** for SMEs — a single source of truth for stock built on an
append-only movement ledger. Every quantity change carries a reason, a reference, an actor, and a
timestamp; balances are *derived* from the ledger, never edited in place.

## Status

- **Phase 0 — Architecture:** ✅ [docs/PHASE-0-ARCHITECTURE.md](docs/PHASE-0-ARCHITECTURE.md)
- **Phase 01 — Foundation / Auth / Organization:** ✅ [docs/PHASE-01-FOUNDATION.md](docs/PHASE-01-FOUNDATION.md)
- **Phase 02+03 — Users/Roles & Product Master:** ✅ [docs/PHASE-02-03-USERS-PRODUCTS.md](docs/PHASE-02-03-USERS-PRODUCTS.md)
- **Phase 05–08 — Inventory Core (Suppliers · Warehouses · Ledger · Balance engine):** ✅ [docs/PHASE-05-08-INVENTORY-CORE.md](docs/PHASE-05-08-INVENTORY-CORE.md)
- **Phase 10 — Receiving (backend + web UI):** ✅ [docs/PHASE-10-RECEIVING.md](docs/PHASE-10-RECEIVING.md)
- **Phase 11 — Releases (approval workflow, backend + web UI):** ✅ [docs/PHASE-11-RELEASES.md](docs/PHASE-11-RELEASES.md)
- **Phase 12 — Transfers (approval + in-transit, backend + web UI):** ✅ [docs/PHASE-12-TRANSFERS.md](docs/PHASE-12-TRANSFERS.md)
- **Phase 14 — Stock Adjustments (approval + high-value 2nd approver, backend + web UI):** ✅ [docs/PHASE-14-ADJUSTMENTS.md](docs/PHASE-14-ADJUSTMENTS.md)
- **Phase 15 — Physical Count (snapshot → count → variance → post, backend + web UI):** ✅ [docs/PHASE-15-PHYSICAL-COUNT.md](docs/PHASE-15-PHYSICAL-COUNT.md)
- **Phase 17+19 — Reorder engine & Dashboard KPIs (backend + web UI):** ✅ [docs/PHASE-17-19-REORDER-DASHBOARD.md](docs/PHASE-17-19-REORDER-DASHBOARD.md)
- **Phase 20 — Reports (valuation, stock status, dead stock; backend + web UI):** ✅ [docs/PHASE-20-REPORTS.md](docs/PHASE-20-REPORTS.md)

**Phase 2** ([plan](docs/PHASE-2-PLAN.md) · [ADRs](docs/adr/)): operational readiness → advanced inventory.
- **2A.1A — Catalog foundations (lifecycle status, master-data UI, audit drawer):** ✅ [docs/PHASE-2A1A-CATALOG-FOUNDATIONS.md](docs/PHASE-2A1A-CATALOG-FOUNDATIONS.md)
- **2A.1B — Products, variants & barcodes (+ BarcodeResolver, product editor):** ✅ [docs/PHASE-2A1B-PRODUCTS-BARCODES.md](docs/PHASE-2A1B-PRODUCTS-BARCODES.md)
- **2A.1C — Inventory policies (warehouse-level reorder engine, single authoritative assessment):** ✅ [docs/PHASE-2A1C-INVENTORY-POLICIES.md](docs/PHASE-2A1C-INVENTORY-POLICIES.md)
- **2A.1D — Suppliers & supplier catalog (lifecycle, audit, archive guard, editor UI):** ✅ [docs/PHASE-2A1D-SUPPLIERS.md](docs/PHASE-2A1D-SUPPLIERS.md)
- **2A.1E — Warehouses & hierarchical locations (lifecycle, archive guards, generic location tree, editor UI):** ✅ [docs/PHASE-2A1E-WAREHOUSES-LOCATIONS.md](docs/PHASE-2A1E-WAREHOUSES-LOCATIONS.md)
- **2A.1F — Audit Explorer (read-model, correlation, redaction, scoped cursor search, explorer UI):** ✅ [docs/PHASE-2A1F-AUDIT-EXPLORER.md](docs/PHASE-2A1F-AUDIT-EXPLORER.md)
- **2A.1 master-data operational readiness — complete.**
- **2A.2A — Global Search (one search entry point across catalog, warehouse, and documents):** ✅ [docs/PHASE-2A2A-GLOBAL-SEARCH.md](docs/PHASE-2A2A-GLOBAL-SEARCH.md)
- **2A.2B — Barcode Scanner UX (wedge/manual/camera → BarcodeResolver, identity panel, diagnostic mode):** ✅ [docs/PHASE-2A2B-SCANNER-UX.md](docs/PHASE-2A2B-SCANNER-UX.md)
- **2A.3A — Bulk Import (staged preview→commit for products, suppliers, opening inventory; ledger-posted, IMPORT-audited):** ✅ [docs/PHASE-2A3A-IMPORT.md](docs/PHASE-2A3A-IMPORT.md)
- **2A.3B — Export (read-only CSV for products, suppliers, stock balances; round-trips as import templates, CSV-injection safe):** ✅ [docs/PHASE-2A3B-EXPORT.md](docs/PHASE-2A3B-EXPORT.md)
- **2A.4 — Hardening (release-readiness gate):** ✅
  - **2A.4A — Sessions & refresh tokens (rotation, reuse detection, revoke/revoke-all, silent web refresh):** ✅ [docs/PHASE-2A4A-SESSIONS.md](docs/PHASE-2A4A-SESSIONS.md)
  - **2A.4B — API hardening (tiered rate limiting, 1 MB payload cap, security headers/CORS allowlist, consistent error shape + structured logging, health/readiness):** ✅ [docs/PHASE-2A4B-API-HARDENING.md](docs/PHASE-2A4B-API-HARDENING.md)
  - **2A.4C — Release engineering (CI: lint/typecheck/test/build + dependency audit; verified backup/recovery runbook):** ✅ [docs/PHASE-2A4C-RELEASE-ENGINEERING.md](docs/PHASE-2A4C-RELEASE-ENGINEERING.md)
- **✅ Phase 2A — Operational Readiness complete.**
- **✅ 2B.1 — Reservations complete** (commitments against availability; [ADR 0005](docs/adr/0005-reservations.md)):
  - **2B.1A — Reservation Core (create/confirm/release/cancel, availability enforcement, concurrency, audit):** ✅ [docs/PHASE-2B1A-RESERVATION-CORE.md](docs/PHASE-2B1A-RESERVATION-CORE.md)
  - **2B.1B — Consumption (releases consume reservations at line level; atomic on_hand + reserved via the ledger; partial/full; idempotent):** ✅ [docs/PHASE-2B1B-CONSUMPTION.md](docs/PHASE-2B1B-CONSUMPTION.md)
  - **2B.1C — Expiry + UX (auto-expiry returns only unconsumed commitments; operational list/detail/create screens, stock drill-down, filtering):** ✅ [docs/PHASE-2B1C-EXPIRY-UX.md](docs/PHASE-2B1C-EXPIRY-UX.md)
- **✅ 2B.2 — Returns + Disposition complete** (reverse logistics into quarantine; [ADR 0006](docs/adr/0006-returns-disposition.md)):
  - **2B.2A — Return Intake (CUSTOMER/SUPPLIER/INTERNAL returns received into quarantine via the ledger; lifecycle, idempotency, audit):** ✅ [docs/PHASE-2B2A-RETURN-INTAKE.md](docs/PHASE-2B2A-RETURN-INTAKE.md)
  - **2B.2B — Inspection + Disposition (split quarantined stock across RESTOCK / DAMAGED / RETURN_TO_SUPPLIER / DISPOSE, each an immutable ledger posting; concurrency-safe, idempotent, deterministic status roll-up):** ✅ [docs/PHASE-2B2B-INSPECTION-DISPOSITION.md](docs/PHASE-2B2B-INSPECTION-DISPOSITION.md)
  - **2B.2C — UX + Visibility (return list/detail/create + disposition drawer with permission gating; quarantine drill-down on Stock Overview reconciling to the ledger balance):** ✅ [docs/PHASE-2B2C-RETURNS-UX.md](docs/PHASE-2B2C-RETURNS-UX.md)
- **✅ Phase 2B — Stock Commitment & Reverse Logistics complete.**
- **✅ 2C.1 — Batch / Lot Tracking complete** (lot is inventory grain; [ADR 0007](docs/adr/0007-batch-lot-tracking.md)):
  - **2C.1A — Lot Core + Receiving (InventoryLot entity + uniqueness/lifecycle/immutability; balance & ledger lot grain; posting-time enforcement; opening + receiving lot capture; legacy backfill; lot query API):** ✅ [docs/PHASE-2C1A-LOT-CORE.md](docs/PHASE-2C1A-LOT-CORE.md)
  - **2C.1B — Lot Propagation (releases with lot allocations [the FEFO seam]; transfers preserve lot identity; adjustments/counts/returns lot-aware; reservations aggregate availability across lots):** ✅ [docs/PHASE-2C1B-LOT-PROPAGATION.md](docs/PHASE-2C1B-LOT-PROPAGATION.md)
  - **2C.1C — Traceability UX (lot explorer, lot detail with per-warehouse stock + movement timeline & document links, shared operational lot picker):** ✅ [docs/PHASE-2C1C-TRACEABILITY-UX.md](docs/PHASE-2C1C-TRACEABILITY-UX.md)
- **2C.2 — Expiry + FEFO** (shelf-life rules + first-expired-first-out allocation; [ADR 0008](docs/adr/0008-expiry-fefo.md)):
  - **2C.2A — Expiry Policy + Eligibility (ShelfLifePolicy; business-date expiry; receiving validation + audited short-dated override; expired/expiring read model; release + picker exclude expired lots):** ✅ [docs/PHASE-2C2A-EXPIRY-POLICY.md](docs/PHASE-2C2A-EXPIRY-POLICY.md)
  - **2C.2B — FEFO Allocation (deterministic FEFO allocator + advisory preview; release auto-generates or revalidates plans under lock; stale-plan conflict; audited fefo_override for non-FEFO manual selection):** ✅ [docs/PHASE-2C2B-FEFO-ALLOCATION.md](docs/PHASE-2C2B-FEFO-ALLOCATION.md)
  - **2C.2C — Expiry UX + Alerts Foundation (expiry dashboard + badges + FEFO preview UX; idempotent LotExpiryFact detection, no notification coupling):** ✅ [docs/PHASE-2C2C-EXPIRY-UX.md](docs/PHASE-2C2C-EXPIRY-UX.md)
- **✅ 2C.2 — Expiry + FEFO complete.**
- **2C.3 — Cycle Counting** (scheduling / ABC planning over the lot-aware Physical Count engine; [ADR 0009](docs/adr/0009-cycle-counting.md)):
  - **2C.3A — ABC + Scheduling Core (ABCClass planning attribute; org/warehouse CycleCountPolicy; MANUAL + MOVEMENT_VELOCITY classification with configurable thresholds; coverage read model + business-date due calc; idempotent CycleCountTask generation with one-active-task-per-scope; history-preserving snapshots; basic assignment):** ✅ [docs/PHASE-2C3A-ABC-SCHEDULING.md](docs/PHASE-2C3A-ABC-SCHEDULING.md)
  - **2C.3B — Count Session Integration (start task → the one authoritative StockCount(type=CYCLE), scope-exact snapshot; complete only after POSTED via the existing ledger path; replay/concurrency-safe start; coordinated cancel; recounts as new superseding work):** ✅ [docs/PHASE-2C3B-COUNT-SESSION.md](docs/PHASE-2C3B-COUNT-SESSION.md)
  - **2C.3C — UX + Metrics (dashboard KPIs [due/overdue, on-time coverage %, accuracy %, variance], worklist with ABC/status/assignee/source/date filters + views, task detail with why-context + policy snapshot routing into the existing count flow, assignment UI; one centralized metrics service):** ✅ [docs/PHASE-2C3C-UX-METRICS.md](docs/PHASE-2C3C-UX-METRICS.md)
- **✅ 2C.3 — Cycle Counting complete.**
- **✅ 2C.4 — Inventory-position model** (one read model over ledger-backed balances feeding a product→warehouse→lot roll-up and a "what can I promise" availability lens; per-bucket drill-downs to reservations/returns/transfers/lots; `available = onHand − reserved − quarantined`, damaged outside on-hand, in-transit never promiseable): ✅ [docs/PHASE-2C4-INVENTORY-POSITION.md](docs/PHASE-2C4-INVENTORY-POSITION.md)
- **✅ Phase 2C — Traceability complete** (Batch/Lot · Expiry+FEFO · Cycle Counting · Inventory Position).
- **2D.1 — Events / Transactional Outbox** (reliable async delivery of committed domain facts; [ADR 0010](docs/adr/0010-transactional-outbox.md)):
  - **2D.1A — Outbox Core (OutboxEvent schema; transactional `enqueue(tx, …)` committing atomically with the business mutation; versioned envelope with correlation/causation/source; dedupe-on-replay; no dispatch yet):** ✅ [docs/PHASE-2D1A-OUTBOX-CORE.md](docs/PHASE-2D1A-OUTBOX-CORE.md)
  - **2D.1B — Relay + Delivery Semantics (DB-backed worker: claim/lease with `FOR UPDATE SKIP LOCKED` + crash recovery; at-least-once delivery to a many-per-type consumer registry with per-consumer receipts; exponential backoff + dead-letter; thin poller; org-scoped `/outbox/health`):** ✅ [docs/PHASE-2D1B-RELAY.md](docs/PHASE-2D1B-RELAY.md)
  - **2D.1C — First Domain Integrations (expiry facts + cycle-count completion enqueue events in the same tx as the domain fact; OperationalFactProjection internal consumer; outbox ops view + permission-gated manual retry):** ✅ [docs/PHASE-2D1C-INTEGRATIONS.md](docs/PHASE-2D1C-INTEGRATIONS.md)
- **✅ 2D.1 — Events / Transactional Outbox complete.**
- **2D.2 — Notifications** (outbox consumer → rule engine → scoped notifications → channels; [ADR 0011](docs/adr/0011-notifications.md)):
  - **2D.2A — Notification Core + In-App Inbox (Notification/NotificationRecipient; explicit org/warehouse-scoped routing rules; outbox NotificationConsumer with idempotent creation; personal inbox APIs + in-app inbox UI; no external channels):** ✅ [docs/PHASE-2D2A-NOTIFICATIONS-CORE.md](docs/PHASE-2D2A-NOTIFICATIONS-CORE.md)
- **Next:** 2D.2B External Delivery Framework + Email (NotificationDelivery + dispatcher + preferences + first outbound channel).
- Pre-2D hygiene: `/inventory/reconcile` now reconciles `reserved` against active reservations (off-ledger, ADR 0005) rather than movement deltas.

The web app now has an auth-guarded shell with Dashboard, Stock Overview, Products, and a working
Receiving flow (create a goods receipt → post to the ledger → stock appears).

## Stack

TypeScript monorepo (npm workspaces + Turborepo) · NestJS API · PostgreSQL 16 + Prisma · Next.js 14 web.

## Quickstart

```bash
npm install
npm run db:up                       # Postgres 16 in Docker (host port 5544)
npm run prisma:generate -w @iw/api
npm run api:migrate                 # apply the foundation migration
npm run api:seed                    # demo org -> admin@demo.test / password123
npm run dev                         # API http://localhost:4100/api · Web http://localhost:3000
```

Tests: `npm run test -w @iw/api` (unit) and `npm run test:e2e -w @iw/api` (e2e vs live Postgres).

## Architecture

The full product & architecture specification lives in:

📄 **[docs/PHASE-0-ARCHITECTURE.md](docs/PHASE-0-ARCHITECTURE.md)**

It covers: recommended stack · user roles · domain architecture · entity model · Mermaid ERD ·
inventory ledger design · stock-balance projection · state machines · screens · API (CRUD vs
command) · permission matrix · WAC costing · barcode/AI/integration architecture · domain events ·
reports · dashboard formulas · MVP vs future scope · roadmap · testing strategy · and the
invariant proof (how stock moves supplier→receiving→reservation→release and
warehouse→transfer→transit→destination **without ever mutating a quantity directly**).

## Core principle

```
Stock Movement Ledger (append-only)  →  Calculated Inventory Balance (projection)
```

Never `product.stock_quantity = newQuantity`. Always post a movement.

## Next step

Begin Roadmap step 01 (Foundation / Auth / Organization), then build the **ledger (07)** and
**balance engine (08)** before any operational document. See §20 of the spec.
