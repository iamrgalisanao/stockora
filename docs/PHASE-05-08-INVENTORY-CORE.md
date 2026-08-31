# Phase 05–08 — Inventory Core (Suppliers · Warehouses · Ledger · Balance engine)

**Status: ✅ Complete and verified.** This is the milestone that makes stock actually move.
Roadmap steps 05 (Suppliers), 06 (Warehouses + Locations), 07 (Inventory Ledger), 08 (Balance
engine), and 09 (Opening Balance).

## Phase 05 — Suppliers
- `suppliers` + `supplier_products`; `products.preferredSupplierId` now a real FK.
- Endpoints: `GET/POST/PATCH /api/suppliers`, `GET/POST/PATCH/DELETE /api/suppliers/:id/products`.
  Reads gated by `inventory.view`, writes by `supplier.manage`; supplier-product `cost` gated by `cost.view`.

## Phase 06 — Warehouses + Locations (+ real warehouse-scope enforcement)
- `warehouses` (typed, default flag, receiving/dispatch flags, manager) + hierarchical
  `warehouse_locations` (cycle-safe).
- Endpoints under `/api/warehouses` (+ `/:id/locations`); reads `inventory.view`, writes `warehouse.manage`.
- **Warehouse scope is now enforced:** a scoped user's warehouse list is filtered, and out-of-scope
  warehouses return **404** (existence hidden). Single default warehouse per org is enforced.

## Phase 07–08 — Inventory Ledger + Balance engine (the core)

### Design decisions (architect)
1. **Explicit signed bucket deltas per movement.** Each `inventory_movements` row stores
   `onHandDelta, reservedDelta, inTransitDelta, quarantinedDelta, damagedDelta`. The deltas *are*
   the source of truth → reconciliation is a pure sum and reversal is a negation. `movementType`
   stays descriptive.
2. **Balance keyed by `(org, product, variant, warehouse)`** with a NIL-UUID sentinel for
   "no variant" — avoids Postgres NULL-uniqueness pitfalls and schema drift.
3. **Atomic, idempotent posting.** Each command runs in one DB transaction. The affected balance
   row is created-if-missing then **`SELECT … FOR UPDATE`** (pessimistic row lock) → no oversell,
   no lost updates. A unique `(org, idempotencyKey)` makes retries safe.
4. **Moving Weighted Average Cost**, computed server-side on every on-hand inflow; outflows are
   valued at current WAC and leave it unchanged. All math in `Prisma.Decimal` (no float).
5. **In-transit is held at the SOURCE** between dispatch and receive (Phase 0 §6). Dispatch touches
   the source only (`on_hand−`, `in_transit+`); receive posts two rows (source `in_transit−`,
   destination `on_hand+`) carrying the source WAC.

### Posting service (`InventoryPostingService`)
Commands (each atomic + idempotent): `openingBalance`, `receipt`, `release`, `adjustment`,
`transferDispatch`, `transferReceive`, `reverseMovement`. These are the primitives the operational
document workflows (receiving, transfers, adjustments — steps 10–15) will call.

### Query service (`InventoryQueryService`)
`listBalances` (available = on_hand − reserved − quarantined; `avgCost`/`value` gated), `listMovements`,
`stockCard` (running on-hand), `getMovements`, and **`reconcile`** (recompute balances from the ledger
and assert equality).

### Endpoints
| Method | Path | Permission |
|---|---|---|
| GET | `/api/inventory/balances` | `inventory.view` |
| GET | `/api/inventory/movements` | `inventory.view` |
| GET | `/api/inventory/products/:id/stock-card` | `inventory.view` |
| POST | `/api/inventory/opening-balances` | `inventory.adjust` (Idempotency-Key aware) |
| POST | `/api/inventory/movements/:id/reverse` | `inventory.adjust` |
| POST | `/api/inventory/reconcile` | `settings.manage` |

## Tests

```bash
npm run test -w @iw/api        # unit: 13
npm run test:e2e -w @iw/api    # e2e: 32 (auth, catalog, ledger, inventory-http)
```
**Ledger integrity suite (`inventory-ledger.e2e`) — the Phase 0 §21 invariants, all green:**
- receive 100 / release 20 → on-hand 80
- transfer: A=100 → dispatch 30 (A on-hand 70, in-transit 30, B 0) → receive 30 (A 70, transit 0, B 30), cost carried
- concurrent releases (8 & 5 vs 10) → exactly one succeeds, never oversold
- idempotent posting → applies once
- reversal + replacement → exact quantity restored
- WAC: 100@100 + 50@120 → 106.6667
- negative-inventory guard → release beyond available rejected
- reconciliation → projection equals ledger

**Verified:** api build ✅, turbo typecheck 4/4 ✅, 13 unit ✅, 32 e2e ✅.

## Migrations
`suppliers`, `warehouses_locations`, `inventory_ledger` (all applied). Seed now includes a supplier,
supplier-product link, and a default `MAIN` warehouse.

## Next
The engine is done — stock can move correctly and auditably. Next is the **document/workflow layer**
that orchestrates it with state machines: **step 10 Receiving**, **11 Releases**, **12 Transfers**
(the in-transit lifecycle), **14 Adjustments**, **15 Physical Count** — each posting through the
services built here. Then reorder, dashboard, and reports.
