# Phase 2C.1A — Lot Core + Receiving (backend)

**Status: ✅ Complete.** First slice of 2C.1 Batch/Lot Tracking. Lot becomes part of the inventory grain,
and lots are created/captured at first legitimate entry (opening inventory + receiving). Governed by
[ADR 0007](adr/0007-batch-lot-tracking.md). FEFO/expiry rules are **out of scope** (2C.2).

## Lot is inventory identity
`InventoryLot(id, org, productId, variantId, lotNumber, manufacturedAt?, expiryDate?, receivedAt?,
supplierId?, status, origin, attributes?)`, unique per **(org, product, variant, lotNumber)** — reusable
across products, never global. Warehouse is deliberately not part of identity. Lifecycle **ACTIVE →
CLOSED → ARCHIVED** (ARCHIVED reserved); a lot with any non-zero bucket cannot be closed; identity fields
are immutable once movements exist.

## Lot joins the grain
- `InventoryBalance` unique key is now `(org, product, variant, warehouse, lotId)`; the ledger movement
  carries `lotId`. Non-lot stock uses the **NIL-UUID sentinel** in the balance projection (keeping the key
  NULL-free, exactly like `variantId`); the movement stores a real nullable `lotId` (`null` for non-batch).
  The unused `batchId` movement hook was renamed to `lotId` and given an FK.
- The posting engine threads `lotId` into the balance key and enforces the policy on **every** posting:
  batch-tracked ⟺ a valid ACTIVE lot of that product/variant; non-batch ⟺ no lot. So quarantine/damaged
  are lot-specific by construction, and flows not yet lot-aware (release/transfer/etc.) correctly refuse
  batch-tracked stock until 2C.1B.

## Entry points (2C.1A)
- **Opening inventory** and **receiving** resolve lot metadata → `lotId` before posting via
  `LotsService.resolveLotId` — **find-or-create** by `(org, product, variant, lotNumber)`. A hit whose
  recorded `manufacturedAt`/`expiryDate` conflicts is a `409` for review (lot identity is stable); a new
  lot validates `expiryDate > manufacturedAt`. Receiving maps a batch-tracked item's `batchNumber` to its
  lot (a non-batch item keeps `batchNumber` as free text and posts with no lot).
- **Lot query API**: `GET /lots` (filters product/status/q, totals summed across in-scope warehouses),
  `GET /lots/:id` (per-warehouse stock breakdown), `POST /lots/:id/close`.

## Migration safety
The schema migration backfills every existing balance/movement to the NIL sentinel — no quantity change.
**Legacy batch stock** (batch-tracked product, NIL-lot, non-zero) is repaired by the explicit, audited
`POST /lots/backfill-legacy`: it creates a synthetic `LEGACY-OPENING-<sku>` lot (`origin =
LEGACY_MIGRATION`) and posts balancing `LOT_MIGRATION` movements (−q at NIL, +q at the lot), so the
append-only ledger stays authoritative and both reconciliation invariants hold. Idempotent.

## Reconciliation (retained + extended)
Asserted in every lot test:
```
StockBalance(lot)              = Σ InventoryMovement deltas for that lot
Product/Warehouse bucket total = Σ over all lots
```

## Tests
- **e2e** (`lot-core.e2e-spec.ts`, 10): batch posting requires a lot / non-batch rejects one; lot number
  unique per product yet reusable across products; reuse-on-later-receipt and conflicting-metadata `409`;
  `expiry > manufacture`; independent per-lot balances reconciling to the ledger; receiving creates/uses a
  lot from the batch number; receiving a batch product without a batch number rejected; org isolation on
  lot reads; cannot close a lot holding stock; legacy backfill creates a synthetic lot and reconciles
  (idempotent). Existing reservation `lockBalance` updated for the new grain. **34 unit + 198 e2e green.**

## Next
**2C.1B — Lot Propagation**: releases (explicit lot allocation), transfers (preserve lot identity),
adjustments, counts, and returns become lot-aware.
