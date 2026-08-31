# Phase 02 + 03 — Users/Roles & Product Master

**Status: ✅ Complete and verified.** Roadmap steps 02 (users + warehouse-scoped permissions)
and 03–04 (product master: categories, units + conversions, products, variants). Suppliers
(step 05) and the preferred-supplier FK are intentionally deferred.

## Phase 02 — Users, Roles & warehouse-scoped permissions

### Endpoints (all require `user.manage`, tenant-scoped)
- `GET /api/roles` — list the org's roles with their permission codes (for assignment UIs).
- `GET /api/users` — list organization members.
- `GET /api/users/:userId` — one member.
- `POST /api/users` — add a member. If the email is new, a password is required and a user is
  created; if the email already exists, they are added to this org with their existing credentials.
- `PATCH /api/users/:userId` — change name, role, warehouse scope, or status.

### Rules enforced
- **Last-administrator protection:** you cannot demote or disable the only active Administrator.
- **No self-disable.**
- Role must exist in the organization; membership is unique per (org, user).
- Every change is written to the audit log (`user.created`, `user.updated`).

### Warehouse-scoped permissions (plumbing)
`Membership.warehouseScope` (`[]` = all warehouses) is stored and surfaced in the principal.
`src/common/warehouse-scope.ts` provides `isWarehouseAllowed` / `assertWarehouseAllowed` /
`filterAllowedWarehouses`. Operational modules (receiving, transfers, releases, counts) will call
these once warehouses exist (Roadmap step 06); until then scopes are stored and returned but not
yet enforced against real warehouse records.

## Phase 03 — Product Master

### Entities (migration `product_master`)
`product_categories` (hierarchical, cycle-safe), `brands`, `units_of_measure`, `unit_conversions`,
`products`, `product_variants`. Money/quantity are `DECIMAL(18,4)` (never float); the API serializes
decimals as strings.

### Endpoints
| Area | Read (`inventory.view`) | Write (`product.manage`) |
|---|---|---|
| Units | `GET /api/units` | `POST /api/units`, `PATCH /api/units/:id` |
| Conversions | `GET /api/unit-conversions` | `POST /api/unit-conversions`, `DELETE /api/unit-conversions/:id` |
| Brands | `GET /api/brands` | `POST /api/brands`, `PATCH /api/brands/:id` |
| Categories | `GET /api/categories` | `POST /api/categories`, `PATCH /api/categories/:id` |
| Products | `GET /api/products`, `GET /api/products/:id` | `POST /api/products`, `PATCH /api/products/:id` |
| Variants | (in product detail) | `POST /api/products/:id/variants`, `PATCH /api/products/:id/variants/:variantId` |

### Rules enforced
- **SKU is unique per organization across BOTH products and variants** (app-level cross-table check).
- **Cost visibility gating:** `cost` fields are returned only to callers with `cost.view`; selling
  price is visible to any `inventory.view` user.
- Referenced units/category/brand must belong to the same organization (400 otherwise).
- Category moves are **cycle-checked** (cannot move a node under its own descendant).
- Unit conversions reject equal from/to and non-positive factors; unique per (org, from, to).
- Adding a variant flips the product's `hasVariants` flag.
- Product create/update audited (`product.created`, `product.updated`).

### Conversion semantics
`1 <fromUom> = <factor> <toUom>`. Seeded demo: `1 BOX = 24 PCS`, `1 CASE = 12 BOX`. Always resolve
to the product's base unit at full precision; round only on display (avoids the rounding corruption
called out in Phase 0 §4).

## Tests

```bash
npm run test -w @iw/api        # unit: 13 (RBAC bundles, PermissionsGuard, warehouse-scope)
npm run test:e2e -w @iw/api    # e2e: 19 (auth 8 + users/catalog 11) vs live Postgres
```
**Verified:** unit 13/13 ✅, e2e 19/19 ✅, api build ✅, turbo typecheck 4/4 ✅. Live smoke test
confirmed units, conversions, and a cost-visible product for the admin.

## Demo data (seed)
`admin@demo.test / password123` · units PCS/BOX/CASE/KG · conversions BOX→PCS, CASE→BOX ·
category Storage · brand Samsung · product `SSD-SAM-1TB-001` (Samsung 1TB SSD).

## Next
**Roadmap step 05 Suppliers** (then wire `products.preferredSupplierId` to a real FK), then the
critical path: **step 06 Warehouses + Locations**, **step 07 Inventory Ledger**, **step 08 Balance
engine** — after which operational documents (receiving, releases, transfers) can post stock.
