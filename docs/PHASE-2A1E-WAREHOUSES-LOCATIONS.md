# Phase 2A.1E — Warehouses & Hierarchical Locations (backend + UI)

**Status: ✅ Complete.** Fifth 2A slice. Warehouses and their location hierarchy reach master-data
operational readiness: the **`EntityStatus` lifecycle**, audit on every mutation, guarded archiving, a
strict-but-generic location tree, and a full editor UI. Rules per
[ADR 0003](adr/0003-master-data-vs-ledger.md).

## Backend
- **Lifecycle:** `Warehouse.status` migrates `WarehouseStatus` → shared `EntityStatus` (adds ARCHIVED);
  `WarehouseLocation` migrates `is_active` → `status`. Data-preserving migration; `is_receiving_area`
  folds into the new `usage` classification (RECEIVING when it was set, else STORAGE).
- **Location model** is a generic tree: `warehouseId`, optional `parentId`, `code`, `name`, free-form
  structural `type` (ZONE/AISLE/RACK/… — suggested, not a fixed sequence), operational `usage`
  (`LocationUsage`: STORAGE/RECEIVING/STAGING/QUARANTINE/DAMAGED/DISPATCH/OTHER), and `isPickable`.
- **Hierarchy invariants:** `code` unique per `(org, warehouse)` (same code allowed in other
  warehouses); `warehouseId` immutable; a dedicated **Move** reparents within the same warehouse only,
  cycle-safe (no self-parent, no ancestor cycle, no cross-warehouse parent).
- **`CanArchiveWarehouse`** blocks ARCHIVE on any non-zero stock bucket
  (on_hand/reserved/in_transit/quarantined/damaged — never `on_hand = 0` alone), any open
  receipt/release/transfer/adjustment/count, any ACTIVE inventory policy, or any active child location.
- **`CanArchiveLocation`** blocks ARCHIVE while inventory movements reference it, an open document line
  references it, or it has active descendants.
- **Operational selectors:** `assertSelectableForCreate` (warehouse must be ACTIVE) and
  `assertLocationSelectable` (location must be ACTIVE + in the warehouse) gate the create paths of
  receiving/releases/transfers/adjustments/counts. Archived/inactive warehouses & locations stay
  readable and resolve in historical documents.
- **Endpoints:** list `?q=&status=`; `POST /warehouses/:id/status`; location `POST …/status`,
  `POST …/move`; `usage` on create/update. `GET /warehouses/:id/policies` (read-only, for the editor).
  All mutations audited (`warehouse.*`, `location.*`).

## Web UI
- **Warehouses list** — search + status filter + `StatusBadge` + New.
- **New warehouse** form.
- **Warehouse editor** with tabs **General / Locations / Policies / History**:
  - *Locations* is a **tree** (indented by depth), with Add root, Add child, Edit, **Move** (a
    controlled "move to parent" selector that excludes the node and its descendants — no drag-and-drop),
    Deactivate/Activate, Archive.
  - *Policies* — read-only reorder policies governing stock in this warehouse (links to each product).
  - *History* — the warehouse audit trail.
- Nav: **Administration → Warehouses**.

## Contract changes
`WarehouseResponse.status` becomes `EntityStatus`; `WarehouseLocationResponse` gains `usage` +
`status` (drops `isReceivingArea`/`isActive`). New `LOCATION_USAGES`, `LocationUsage`,
`LOCATION_TYPE_SUGGESTIONS`. `InventoryPolicyResponse` gains `productSku`/`productName` (for the
warehouse-centric policy view).

## Tests
- **e2e** (`warehouses-locations.e2e-spec.ts`, 15): duplicate warehouse code; location code unique per
  warehouse but reusable across warehouses; self-parent, ancestor-cycle and cross-warehouse parent
  rejected (create + move); move preserves warehouseId; warehouse archive blocked by stock / open doc /
  active policy / active location; location archive blocked by movements / active descendants; a
  location with movements still moves within its warehouse but never across; inactive warehouse &
  location excluded from new operations yet still resolvable; every mutation audited. **23 unit + 94 e2e
  green.**

## Follow-up from 2A.1D
`Supplier.isPreferred` is now surfaced as **"Preferred Vendor (strategic classification)"** with an
explicit UI note that the operational reorder source of truth is the `preferredSupplierId` link.

## Deferred
Per-location balances / inventory-position redesign stays out of scope — `usage` is classification
metadata over the existing bucket model, not a replacement. Wiring `assertLocationSelectable` into
releases/adjustments item paths (receiving already enforces it) and location history in the UI are
natural follow-ups.
