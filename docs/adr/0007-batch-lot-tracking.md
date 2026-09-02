# ADR 0007 — Batch / Lot Tracking (Phase 2C.1)

**Status:** Accepted · **Date:** 2026-09-03 · **Related:** [0005 Reservations](0005-reservations.md), [0006 Returns](0006-returns-disposition.md)

## Context

Lot/batch tracking makes **lot** part of the inventory grain. It is the foundation for expiry/FEFO,
recall, and supplier-quality analytics (all later). Because it changes the grain of the balance
projection and the ledger, the model is frozen here before any migration. FEFO, expiry rules, and
expiry alerting are **explicitly out of scope** (Phase 2C.2).

## Core principle

> **A lot is physical/traceability identity, not product master data, and not a cost layer.** One
> immutable lot identity is preserved as stock enters, moves between warehouses/locations, is committed,
> quarantined, returned, and counted.

`InventoryLot ≠ CostLayer`. Costing stays moving-weighted-average (WAC), operating independently; a lot
may be received at several costs and WAC absorbs them as today.

## 1. Lot is a real entity, keyed per product

```
InventoryLot(id, organizationId, productId, variantId, lotNumber,
             manufacturedAt?, expiryDate?, receivedAt?, supplierId?,
             status, origin, attributes?(jsonb), createdAt)
UNIQUE (organizationId, productId, variantId, lotNumber)
```

Uniqueness is **per product/variant**, never global — different products may share a manufacturer's lot
number. **Warehouse is NOT part of lot identity**: the same lot moves between warehouses and stays the
same lot. `variantId` uses the `NIL_UUID` sentinel for base product (matches the balance/movement grain).

## 2. Lot joins the inventory grain (the load-bearing decision)

Today the balance projection is keyed `(org, product, variant, warehouse)` — **location is not part of
the balance grain** (it is a movement attribute only). Lot joins that same grain:

```
InventoryBalance UNIQUE (organizationId, productId, variantId, warehouseId, lotId)
InventoryMovement.lotId  (the ledger follows the same grain)
```

**Sentinel, not NULL.** To keep the balance unique key NULL-free and one-row-per-key (exactly how
`variantId` already works), the balance projection stores `lotId = NIL_UUID` for non-batch stock. The
**movement** `lotId` is a real nullable FK (`null` for non-batch, the lot's id for batch-tracked); the
posting service maps `movement.lotId ?? NIL_UUID` into the balance key, mirroring `variantId`. The
domain/contracts expose `lotId` as `null` when it is the sentinel.

The existing unused `InventoryMovement.batchId` hook is **renamed to `lotId`** and given an FK to
`inventory_lots` (no data exists on it, so the rename is safe). `serialId` is left untouched (serial is
future work).

One inventory truth model is preserved — buckets (`onHand/reserved/quarantined/damaged/inTransit`) keep
their meaning; only the grain becomes finer. Quarantine and damaged are therefore **lot-specific** by
construction, which is what recall/expiry will later depend on.

## 3. Tracking requirement enforced at posting time

For `product.isBatchTracked = true`, **every physical posting must carry a valid lot** of that product:
opening inventory, receiving, release, transfer (both legs), adjustment, physical/cycle count, return
receipt, and disposition. For `isBatchTracked = false`, lot must be **absent** (posting a lot is
rejected) — one SKU never gets two inventory semantics. The flag is already immutable once a product has
movements (existing guard), so a product cannot flip tracking mode mid-life.

2C.1A wires opening inventory + receiving; 2C.1B threads the rest.

## 4. Lots are created at first legitimate entry, with stable metadata

Receiving/opening does **find-or-create** by `(org, product, variant, lotNumber)`. A find that hits an
existing lot whose **identity metadata conflicts** (a different `manufacturedAt`/`expiryDate` than
recorded) is a **conflict → 400 requiring review**, never a silent overwrite. `expiryDate` must be
`> manufacturedAt` when both are present (the only expiry validation in 2C.1; no FEFO/alerts).

## 5. Transfers preserve lot identity

A transfer never creates a new lot: both the dispatch (`onHand −q, inTransit +q`) and receive
(`inTransit −q, onHand +q`) legs carry the **same `lotId`**. (Implemented in 2C.1B.)

## 6. Releases allocate lots explicitly (no FEFO yet)

A batch-tracked release requires **explicit lot allocation** via an allocation child, not a single
`lotId` on the line:

```
ReleaseLine └─ ReleaseAllocation[] (lotId, locationId?, quantity)
```

Manual allocation today and FEFO-generated allocation later share this one model — a deliberate
architectural boundary. (Implemented in 2C.1B; FEFO in 2C.2.)

## 7. Reservations stay lot-agnostic at creation

Reservations remain product/warehouse-level commitments (as shipped in 2B.1). Batch tracking does **not**
force a lot at reserve time; lot allocation happens at release/consumption. A future `ReservationAllocation`
may add optional lot pinning, but is not required now. (No change in 2C.1A.)

## 8. Returns preserve known lot identity

A batch-tracked return requires a **recognized lot**; the returned stock lands in quarantine under
`product + lot`, not a generic product bucket. An unidentifiable lot is **not** silently folded into an
existing lot — for 2C.1 the policy is "batch-tracked returns require a recognized lot." A future
`UNKNOWN/INVESTIGATION` lot may be added if a real need arises. (Implemented in 2C.1B.)

## 9. Physical counts count lots

For batch-tracked products a count is `location → product → lot → counted qty`, with **lot-level
variance** — a product total can reconcile while lot composition is wrong, which traceability must catch.
(Implemented in 2C.1B.)

## 10. Lot lifecycle & immutability

Lifecycle: **ACTIVE → CLOSED → ARCHIVED** (2C.1A uses ACTIVE/CLOSED; ARCHIVED reserved). Lots are not
casual master data — there is no `INACTIVE` toggle.
- **ACTIVE**: may participate in current stock operations.
- **CLOSED**: no remaining physical exposure; retained historically. **A lot with any non-zero bucket
  cannot be closed.**
- **ARCHIVED**: historical-only administrative state (deferred).

Once a lot has any movement, its **identity fields (`productId`, `variantId`, `lotNumber`) are
immutable**. `manufacturedAt`/`expiryDate` are protected too: correctable only via an explicitly audited
privileged operation (deferred to a later slice), never ordinary edit.

## Migration safety (legacy stock)

Existing balances/movements predate lots. The schema migration adds `lotId`, backfilling **every existing
row to `NIL_UUID`** (they are, by definition, non-lot-grain history) and rebuilding the balance unique
key — no quantity changes, fully reconcilable.

Stock of a product that was flagged `isBatchTracked` *before* lots existed is **legacy batch stock**
(batch-tracked product, `NIL_UUID` lot, non-zero buckets). It is repaired by an **explicit, audited
backfill operation** (`POST /inventory/lots/backfill-legacy`), never a silent schema rewrite: for each
such balance it creates a clearly synthetic lot (`lotNumber = LEGACY-OPENING-…`, `origin =
LEGACY_MIGRATION`) and posts a **balancing `LOT_MIGRATION` movement pair** (bucket `−q` at `NIL_UUID`,
`+q` at the synthetic lot) so the append-only ledger stays the source of truth and both reconciliation
invariants hold. The synthetic origin is surfaced in the UI later — it never claims traceability that did
not historically exist.

## Reconciliation invariants (retained + extended)

The practice that caught the 2B.2A bug is kept and extended — asserted in tests after every lot operation:

```
StockBalance(lot)            = Σ InventoryMovement deltas for that (grain, lot)
Product/Warehouse bucket total = Σ over all lots of that bucket
```

The second invariant catches migration and aggregation errors.

## Slices

- **2C.1A — Lot Core + Receiving:** `InventoryLot` schema + lifecycle + invariants; balance lot-grain
  migration; movement `lotId` FK; opening-inventory + receiving lot support; legacy backfill operation;
  basic lot query API; heavy reconciliation tests. **(This slice — backend.)**
- **2C.1B — Lot Propagation:** releases (allocation model), transfers, adjustments, counts, and returns
  become lot-aware.
- **2C.1C — Traceability UX:** lot explorer, stock-by-lot, movement genealogy, filters, operational lot
  selection.

## Definition of done (2C.1)

> A batch-tracked product can enter, move through, and leave inventory while preserving one immutable lot
> identity across warehouses, locations, operational documents, quarantine, returns, and inventory counts,
> with lot-level balances fully reconcilable to the ledger and to aggregate product balances.

Then 2C.2 can add expiry, FEFO, expired-stock rules, and alerts **without changing the identity model again.**
