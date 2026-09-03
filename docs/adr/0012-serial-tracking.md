# ADR 0012 — Serial Tracking (Phase 2D.3)

**Status:** Accepted · **Date:** 2026-09-03 · **Related:** [0007 Batch/Lot Tracking](0007-batch-lot-tracking.md), [0005 Reservations](0005-reservations.md), [0006 Returns](0006-returns-disposition.md)

## Context

High-value goods need **unit-level identity** — which exact physical unit was received, where it is, and to
whom it shipped — a dimension below the lot. 2D.3 adds that without disturbing the ledger-backed quantity
model. This ADR freezes the model before any migration.

## Central principle

> **Serial state is a projection of physical identity, not a replacement for the inventory ledger.** The
> append-only ledger + balance projection remain authoritative for quantities; the serial registry must
> **reconcile** to them. A serial is an identity, not a quantity.

## Core decisions

**1. Registry-with-state, NOT a `StockBalance` grain.** Serials are `InventorySerial` rows carrying a
physical state — never a new axis on the balance projection (a 500-unit receipt must not become 500 balance
rows). Single-issue is guaranteed by serial-status transitions + movement links, and the serialized quantity
still reconciles to the lot/product balance.

**2. `Product.isSerialized` says *whether*; a product-level `SerialTrackingPolicy` says *when*.**
```
SerialTrackingPolicy
- productId
- captureMode: RECEIPT | ISSUE     (default RECEIPT)
- requireLotWhenBatchTracked: true
```
Capture timing is policy, not overloaded onto the boolean.

**3. The registry — one row = one physical unit; quantity never appears.**
```
InventorySerial
- id, organizationId, productId, variantId?
- serialNumber
- lotId?                 (set for batch-tracked products; the serial nests under its lot)
- status
- currentWarehouseId?, currentLocationId?
- lastMovementId?        (links serial state to the authoritative ledger movement)
- receivedAt?, issuedAt?
```
Uniqueness: `UNIQUE(organizationId, productId, variantId, serialNumber)` — product-scoped, safe for
manufacturer serial schemes that collide across SKUs.

**4. Core invariant.** An active serialized unit represents **at most one** physical inventory unit and
occupies **only one** operational state/location at a time.

**5. Physical lifecycle — no document-state duplication.**
```
IN_STOCK · RESERVED · IN_TRANSIT · QUARANTINED · DAMAGED · ISSUED · DISPOSED
```
There is **no permanent `RETURNED` state** — a return is `ISSUED → QUARANTINED` and lives in the movement
history, not as a lifecycle value. **`RESERVED` is defined but deferred:** v1 reservations are quantity-level
(decision 10), so a serial is **never** transitioned to `RESERVED` — it stays `IN_STOCK` while a
quantity-level reservation lives separately. The registry must not claim "SN-001 is reserved" when the
reservation only commits "one of these 20 units." `RESERVED` activates only when serial-specific allocation
is built. So the **v1 active lifecycle** is effectively `IN_STOCK · IN_TRANSIT · QUARANTINED · DAMAGED ·
ISSUED · DISPOSED`.

**6. Capture at receipt is on the goods-receipt line, inside one atomic posting.** For `captureMode=RECEIPT`,
serial identity is captured directly on the line and must be complete before posting — no separate
post-receipt serialization step (which would leave the ledger claiming N units while the registry knows 0..N-1).
```
GoodsReceiptLine { quantity, lotNumber?, serialNumbers[] }
BEGIN  validate line · resolve/create lot · validate serial count+uniqueness · post the movement ·
       update balance · create InventorySerial rows · link lastMovementId · audit  COMMIT
```
All-or-nothing: any duplicate/invalid serial fails the line/document **before** physical inventory commits.
Validation rules: **quantity must be an integer** for a serialized product (no receiving 2.5 units);
`serialNumbers.length === received quantity` (received, not ordered); reject duplicates **within a line** and
**across lines in the same receipt**; reject empty values; **normalize surrounding whitespace but preserve
the submitted case** (manufacturer serials may be case-sensitive; uniqueness is **case-sensitive** in v1).
The internal capture shape is kept extensible (`{ serialNumber, capturedAt?, captureSource? }`) so the
scanner UI can add metadata later without redesigning the posting engine — the 2D.3A DTO is just
`serialNumbers: string[]`.
- `ISSUE` mode: receiving needs no serials (balance rises normally); releasing quantity *M* requires
  **exactly M** serials, registered/assigned at issue and set `ISSUED`. A previously issued serial can
  **never** be reused. (2D.3B.)

**6a. The quantity ledger is NOT exploded into per-unit postings.** A receipt of ten serialized units is one
movement (`qty +10`); the ten serial identities are associated to that movement via `lastMovementId`. The
registry enriches traceability; it never turns one quantity posting into N.

**7. Batch + serial nesting.** For a batch-tracked product, every serial carries a `lotId` and it **must
match the lot of the movement it participates in** (`requireLotWhenBatchTracked`). Traceability nests
`lot → serials`.

**8. Reconciliation is a health invariant (not a balance change), with an explicit bucket mapping.** Do not
reduce it to `count(IN_STOCK) == onHand`; map each physical serial state to its bucket deliberately:
```
IN_STOCK    ↔ on_hand (the non-reserved, non-quarantined physical portion)
IN_TRANSIT  ↔ in_transit
QUARANTINED ↔ quarantined
DAMAGED     ↔ damaged
ISSUED      ↔ (outside inventory)
DISPOSED    ↔ (outside inventory)
RESERVED    ↔ (unused in v1 — reservations are quantity-level)
```
At product/warehouse(/lot) scope, the count of serials in each in-inventory state must equal the matching
balance bucket's serialized quantity. Checked, never used to mutate balances.

**9. Registry state changes ride the existing operations.** Release `IN_STOCK|RESERVED → ISSUED`; transfer
`IN_STOCK → IN_TRANSIT → IN_STOCK` at destination (same serial id throughout); return `ISSUED → QUARANTINED`
then disposition `QUARANTINED → IN_STOCK | DAMAGED | DISPOSED`. `lastMovementId` links each transition to its
ledger movement.

**10. Reservations are not serial-specific in v1.** Consistent with lots (ADR 0005): reserve a *quantity*;
pick/issue assigns the specific serials. Serial-level reservation (asset assignment) can be added later if a
real use case needs it.

**11. Serial identity is immutable after its first movement.** `serialNumber`, `productId`, and (once set)
`lotId` never change once the unit has participated in a movement; only `status`/location advance.

## Slices

- **2D.3A — Serial Core + Receiving:** this ADR; `InventorySerial` + `SerialTrackingPolicy`; uniqueness;
  capture-at-receipt (exact count, lot nesting, atomic with the receipt); serial query API; the
  reconciliation check. No propagation yet.
- **2D.3B — Propagation:** release, transfer, reservation consumption, returns/disposition, adjustments/
  counts, and capture-at-issue — each advancing serial state atomically with its ledger movement.
- **2D.3C — Traceability UX:** serial explorer, serial detail/history, a shared serial picker/scanner,
  stock/lot drill-down, operational selection.

## Mandatory invariants (2D.3A, tested)

Serialized receipt requires the exact serial count (`length === received quantity`) in RECEIPT mode; a
non-integer serialized quantity is rejected; a duplicate serial within a line, and across lines in the same
receipt, is rejected; a duplicate serial within a product is rejected while the same serial number on another
product is allowed; empty/whitespace-only serials are rejected and surrounding whitespace is trimmed while
case is preserved; a non-serialized product rejects serial capture; a batch+serial product requires each
serial's lot to match the receipt lot (and inherits the resolved `lotId`); the serial registry writes
**atomically** with the receipt (a receipt rollback leaves no serial rows) and the ledger records **one**
quantity movement, not N; each received serial becomes `IN_STOCK`; serialized quantity reconciles to the
serial-registry count per the bucket mapping; serial identity is immutable after a movement; cross-org serial
lookup is blocked; a historical serial remains readable after product archival.

## Definition of done (2D.3A)

> A serialized product can capture exact per-unit identities at receipt — nested under their lot when
> batch-tracked, unique within the product, written atomically with the ledger movement, and reconciling to
> the balance — without serials becoming a quantity axis on the balance projection.
