# Phase 2D.3A — Serial Core + Receiving

**Status: ✅ Complete.** First slice of 2D.3 ([ADR 0012](adr/0012-serial-tracking.md)). Unit-level identity
as a **registry-with-state** over the append-only ledger — capture at receipt, product-scoped uniqueness, a
serial query API, and the reconciliation health check. No propagation yet (release/transfer/return state
transitions and capture-at-issue land in 2D.3B).

## Central principle held

> **Serial state is a projection of physical identity, not a replacement for the inventory ledger.**

Serials are `InventorySerial` rows carrying a physical `status` — never a new axis on the balance projection.
A 3-unit serialized receipt is **one** `PURCHASE_RECEIPT` movement (`qty +3`) with three serial identities
linked to it via `lastMovementId`, not three unit movements. The serialized quantity still reconciles to the
product/warehouse/lot balance.

## Model

- **`SerialTrackingPolicy`** (`@@unique(organizationId, productId)`): `captureMode: RECEIPT | ISSUE`
  (default `RECEIPT`), `requireLotWhenBatchTracked` (default `true`). `Product.isSerialized` says *whether*;
  the policy says *when*. No stored row ⇒ implicit `RECEIPT` defaults.
- **`InventorySerial`**: `id, organizationId, productId, variantId (NIL sentinel), serialNumber, lotId?,
  status, currentWarehouseId?, currentLocationId?, lastMovementId?, receivedAt?, issuedAt?`.
  `@@unique(organizationId, productId, variantId, serialNumber)` — product-scoped, **case-sensitive**, safe
  for manufacturer serial schemes that collide across SKUs. `status` defaults `IN_STOCK`.
- **`GoodsReceiptItem.serialNumbers String[]`** — serials captured directly on the receipt line.

## Capture at receipt — one atomic transaction

`GoodsReceiptLine { quantity, lotNumber?, serialNumbers[] }`. All serial rules are validated **before** any
physical inventory commits (all-or-nothing), then the ledger movement, balance update, serial-registry
insert, and receipt close all run in **one** `$transaction` — a rollback leaves no serial rows. Validation
(RECEIPT mode, serialized product):

- quantity must be an **integer** (no receiving 2.5 serialized units);
- `serialNumbers.length === received quantity` (received, not ordered);
- reject duplicates **within a line** and **across lines** in the same receipt (product/variant scoped);
- reject empty/whitespace-only values; **trim surrounding whitespace, preserve case**;
- reject a serial already registered for the product; the **same string on another product is allowed**;
- a non-serialized product rejects serial capture; an `ISSUE`-mode product rejects serials at receipt
  (stock still rises normally — serials are assigned at issue in 2D.3B);
- batch + serial: each serial inherits the **resolved `lotId`** of its line (nesting `lot → serials`).

Posting stays idempotent: a re-post short-circuits on `postedAt`, and a concurrent double-post loses the race
on the movement's unique idempotency key and returns the already-posted receipt (no double count, no extra
serials). The DTO is just `serialNumbers: string[]`; the internal capture shape is kept extensible for a
scanner UI later.

## Reconciliation (health invariant, never a balance mutation)

`GET /serials/reconcile` maps each in-inventory serial state to its balance bucket and compares counts at
product/variant/warehouse/lot scope:

```
IN_STOCK ↔ on_hand · IN_TRANSIT ↔ in_transit · QUARANTINED ↔ quarantined · DAMAGED ↔ damaged
ISSUED / DISPOSED ↔ outside inventory · RESERVED ↔ unused in v1 (reservations are quantity-level)
```

Any mismatch is reported as a drift row; it never mutates balances.

## API

- `GET /serials` — registry query (`productId`, `warehouseId`, `status`, `lotId`, `serialNumber`, `q`);
  warehouse-scoped to the caller. `GET /serials/:id` — single serial (cross-org lookup 404s; a historical
  serial stays readable after its product is archived).
- `GET /serials/reconcile` — reconciliation result. All three require `serial.view`.
- `GET/PUT /serials/policies/:productId` — read/upsert capture policy (`serial.view` / `serial.manage_policy`).

Permissions `serial.view` + `serial.manage_policy` are seeded onto Administrator, Inventory Manager, and
Warehouse Manager; `serial.view` also onto Warehouse Staff, Auditor, and Viewer.

## UI

- **Serials** page (`/serials`): registry table with warehouse/status/serial filters and a reconciliation
  banner (green when the registry reconciles; a drift table otherwise).
- **Receiving form**: a serialized line reveals a per-unit serial-number capture box with a live
  "N entered of M" counter; a batch-tracked line reveals a lot-number field. Serials post atomically with
  the receipt.

## Tests

`test/serial-core.e2e-spec.ts` (14) covers the full mandatory invariant list: exact count, non-integer
rejection, within-line and cross-line duplicates, product-scoped uniqueness (and cross-product allowance),
whitespace trim / case preservation / empty rejection, non-serialized rejection, batch+serial lot nesting +
per-lot reconciliation, org-wide reconciliation, one-movement-not-N, each unit `IN_STOCK`, immutability +
idempotent replay, ISSUE-mode policy, cross-org lookup blocked, and readability after product archival.
Full suite green (46 suites / 330 tests) and verified end-to-end in the running app.

## Definition of done

> A serialized product captures exact per-unit identities at receipt — nested under their lot when
> batch-tracked, unique within the product, written atomically with the ledger movement, and reconciling to
> the balance — without serials becoming a quantity axis on the balance projection. ✅
