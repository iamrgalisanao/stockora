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
- **2A.4 — Hardening (release-readiness gate), in progress:**
  - **2A.4A — Sessions & refresh tokens (rotation, reuse detection, revoke/revoke-all, silent web refresh):** ✅ [docs/PHASE-2A4A-SESSIONS.md](docs/PHASE-2A4A-SESSIONS.md)
  - **2A.4B — API hardening (tiered rate limiting, 1 MB payload cap, security headers/CORS allowlist, consistent error shape + structured logging, health/readiness):** ✅ [docs/PHASE-2A4B-API-HARDENING.md](docs/PHASE-2A4B-API-HARDENING.md)
  - **Next:** 2A.4C release engineering (CI + dependency audit, backup/recovery runbook).

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
