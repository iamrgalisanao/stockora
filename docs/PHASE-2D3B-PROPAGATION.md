# Phase 2D.3B — Serial Propagation

**Status: ✅ Complete.** Second slice of 2D.3 ([ADR 0012](adr/0012-serial-tracking.md)). One immutable serial
identity now moves through every operational workflow — release, transfer, return, disposition, adjustment,
and physical count — each transition riding its ledger movement, with the registry always reconciling to the
balance buckets. No new ADR (the semantic model was frozen in ADR 0012).

## Lifecycle transitions

```
Release          IN_STOCK → ISSUED
Transfer dispatch  IN_STOCK → IN_TRANSIT           (in-transit held at the source)
Transfer receive   IN_TRANSIT → IN_STOCK           (at the destination; same serial ids)
Return intake      ISSUED → QUARANTINED
Disposition        QUARANTINED → IN_STOCK (restock) | DAMAGED | DISPOSED
Adjustment OUT     IN_STOCK → DISPOSED | DAMAGED   (explicit serials; DAMAGED posts on_hand→damaged)
Adjustment IN      (new) → IN_STOCK                (controlled registration, never anonymous +N)
Count reconcile    expected−observed → DISPOSED (loss) · observed−expected → IN_STOCK (found)
```

Every transition is validated **before** its ledger movement posts and applied **inside the same posting
transaction**, so an invalid serial fails the workflow before stock changes, and a rollback leaves the
registry untouched (ADR 0012 §9). `lastMovementId` links each serial state change to its authoritative
movement.

## Capture timing

- **RECEIPT-capture products** (default): release/transfer/adjustment-out/return/disposition **select
  existing** serials — arbitrary new numbers are rejected; the serial must be in the expected prior state
  and at the expected warehouse (and lot, for batch+serial).
- **ISSUE-capture products**: receiving raises quantity with no serials; the release **creates** exactly
  `qty` serials at issue and sets them `ISSUED`. A serial number, once used, can never be reused (uniqueness).

## Batch + serial

Every selected/created serial must nest under the movement's lot: a batch release validates that per-lot
serial counts equal the effective lot allocations, and no serial ever "jumps" lots. Transfers preserve the
same serial ids across both legs and the destination receive validates the arriving set equals the dispatched
set (no substitution).

## Reservations

Unchanged — quantity-level (ADR 0012 §10). A serial is **never** moved to `RESERVED` in this slice; specific
serials are chosen only when the physical release is prepared/posted.

## Reconciliation refinement

`IN_STOCK` maps to the **non-quarantined** physical portion of on-hand (`onHand − quarantined`) — quarantined
stock is held within on-hand, damaged sits outside it, and a v1 reservation never removes a serial from
`IN_STOCK`. Reconciliation covers RECEIPT-capture products (ISSUE-capture products deliberately leave in-stock
quantity un-serialized, so they are excluded from the balance check).

## Model

Serial arrays ride the document items that move state: `StockReleaseItem.serialNumbers`,
`StockTransferItem.serialNumbers` (persisted at dispatch, validated unchanged at receive),
`ReturnLine.serialNumbers`, `ReturnDisposition.serialNumbers`, `StockAdjustmentItem.serialNumbers` +
`serialDisposition` (DISPOSED | DAMAGED), and `StockCountItem.expectedSerials` / `observedSerials`.

## API

- Release `POST /releases/:id/post` accepts `serials: [{ itemId, serialNumbers }]`.
- Transfer `POST /transfers/:id/dispatch` accepts `serials: [{ itemId, serialNumbers }]`; receive uses the
  stored set.
- Return `POST /returns` lines carry `serialNumbers`; `POST /returns/:id/dispositions` carries `serialNumbers`.
- Adjustment items carry `serialNumbers` (+ `serialDisposition` for OUT).
- Count entries accept `observedSerials`; the counted quantity is derived from the observed set.

Serialized `post`/`dispatch`/`adjustment`/`count` now run their ledger movements through a single
`postLineInTx` transaction alongside the serial transitions (idempotent on replay; a concurrent double-post
loses on the movement's unique key and returns the already-posted document).

## UI

The **Serials** registry now reflects the full lifecycle as serials move; a serial row links to a detail view
(status, warehouse, lot, received/issued timestamps, last movement). Operational serial pickers/scanners in
the release/transfer/return forms are the 2D.3C Traceability UX slice.

## Tests

`test/serial-propagation.e2e-spec.ts` (13) covers the full mandatory list: RECEIPT-mode release selects
existing serials / cannot double-issue; capture-at-issue creates exactly `qty` (and a duplicate rolls back);
batch+serial lot match; transfer dispatch→IN_TRANSIT and receive→IN_STOCK with no substitution; return of a
previously ISSUED serial (unknown/in-stock rejected) into QUARANTINE; disposition to IN_STOCK/DAMAGED/DISPOSED;
serialized adjustment OUT (remove) + IN (register); physical count expected-vs-observed reconciliation;
non-serialized paths unchanged; cross-org lookup blocked; readability after issue/disposal; and the full
integration scenario (receive 001/002/003 → release 001 → transfer 002 → return+restock 001 → damage 003) with
one state per identity, nothing lost or duplicated, and balances reconciling. Full suite green (47 suites /
343 tests).

## Definition of done

> A serialized unit can move through release, transfer, return, and disposition workflows using one immutable
> serial identity, with capture-at-issue supported where configured and registry state always reconciling to
> the ledger-backed inventory quantities. ✅

**Next:** 2D.3C — Traceability UX (serial explorer, serial history, shared serial picker/scanner, operational
selection in the workflow forms).
