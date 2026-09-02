# Phase 2B.2A — Return Intake (backend)

**Status: ✅ Complete.** First slice of 2B.2 Returns + Disposition. Returned physical stock can now be
recorded and received into **quarantine** — physically present but not sellable — via an immutable
ledger movement. Governed by [ADR 0006](adr/0006-returns-disposition.md).

## Core principle (ADR 0006)
> Receiving a return and deciding what to do with it are **separate, immutable business events.**

2B.2A ships the first event (intake). Inspection/disposition is 2B.2B; operational UX is 2B.2C. The full
schema (including `ReturnDisposition`) lands here to avoid migration churn, but only intake is wired.

## The document
`InventoryReturn` (`type` CUSTOMER/SUPPLIER/INTERNAL, `warehouseId`, `sourceReference?`, `status`,
`reason?`, `notes?`, `receivedAt?`, `completedAt?`) with `ReturnLine`s (`productId` + `variantId` at the
ledger grain — NIL-UUID = base product — plus `quantity` declared, `receivedQuantity`, `disposedQuantity`)
and a `ReturnDisposition` child table reserved for 2B.2B. Numbered `RTN-000001` per org.

## Intake semantics
Receiving posts one `RETURN_RECEIPT` movement per line:

```
on_hand      +q
quarantined  +q      →  available = on_hand − reserved − quarantined  (unchanged)
```

The returned units are physically on hand but **held**, so sellable availability does not move. The new
`RETURN_RECEIPT`, `RETURN_RESTOCK`, `RETURN_DISPOSE` movement types were added to the ledger vocabulary
(restock/dispose are used by 2B.2B). The buggy Phase-0 `CUSTOMER_RETURN` default (`quarantined +q` only,
which would have *dropped* availability) was corrected to `on_hand +q, quarantined +q` in the same pass.

## Lifecycle
```
DRAFT → RECEIVED | CANCELLED
```
(`RECEIVED → PARTIALLY_DISPOSED → COMPLETED` arrives with disposition in 2B.2B.)

- **Cancel only before receipt** — a received return returns `409` on cancel.
- **Immutable after receipt** — a cancelled return returns `409` on receive.
- **Idempotent receive** — a stable `idempotencyKey` (`return_receive:<id>`) means re-receiving never
  double-raises quarantine; movements post *before* the document flips, matching the receiving flow.
- **New-intake gating** (invariant 10) — an inactive/archived product, variant, location, or warehouse
  cannot be used to draft a new return; historical returns still resolve archived master data (invariant 11).

## Permissions
Added `return.view / return.create / return.receive / return.inspect / return.dispose`. Warehouse staff
get view/create/receive/inspect (intake + restock); managers and admin additionally get `return.dispose`
(the destructive outcomes, enforced in 2B.2B). `return.view` also granted to Viewer.

## Tests
- **e2e** (`return-intake.e2e-spec.ts`, 11): intake raises on_hand + quarantined and leaves availability
  unchanged; receipt idempotent; per-line received-quantity override; cancel before receipt (and its
  ledger untouched); cannot cancel after receipt; cannot receive a cancelled return; archived product and
  inactive warehouse rejected for new intake; org scope in list + detail; status/search filters;
  historical return resolves an archived product. **34 unit + 168 e2e green.**

## Next
**2B.2B — Inspection + Disposition**: inspect quarantined stock and split it across RESTOCK / DAMAGED /
RETURN_TO_SUPPLIER / DISPOSE, each an immutable posting, with `ReturnDisposition` records and status roll-up.
