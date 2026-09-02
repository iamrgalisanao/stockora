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
- **Next:** Reports (valuation, low/out-of-stock, aging) — management-visibility slice B.

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
