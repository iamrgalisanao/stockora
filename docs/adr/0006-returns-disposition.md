# ADR 0006 — Returns + Disposition (Phase 2B.2)

**Status:** Accepted · **Date:** 2026-09-02 · **Supersedes:** none · **Related:** [0005 Reservations](0005-reservations.md)

## Context

Returned physical stock must re-enter the system without becoming sellable before it has been inspected.
Returns are the foundation for damaged/quarantine handling, supplier returns, and (later) batch/serial
traceability, so the state semantics are locked here before any code.

## Core principle

> **Receiving a return and deciding what to do with it are two separate, immutable business events.**

The default path:

```
Return received  →  QUARANTINE  →  Inspection / disposition ─┬─ RESTOCK
                                                             ├─ DAMAGED
                                                             ├─ RETURN_TO_SUPPLIER
                                                             └─ DISPOSE
```

Each event posts its **own** append-only ledger movement(s). The intake movement is **never mutated**
when inspection happens; the ledger reads chronologically and the full history is reconstructable.

Document `status` records **workflow**; it never encodes **inventory condition**. Condition lives in the
balance buckets (quarantined / damaged) and in the per-decision `ReturnDisposition` records.

## Bucket & ledger semantics (the load-bearing decision)

This engine's balance model — unchanged by this ADR — is:

- `on_hand` is the **primary physical pool**; `reserved` and `quarantined` are **subsets of it** (present
  but committed / held).
- `in_transit` and `damaged` are **separate pools, outside `on_hand`** (the existing `DAMAGE`/`EXPIRY`
  movements already move stock *out of* `on_hand` into `damaged`).
- `available = on_hand − reserved − quarantined` (damaged is already excluded because it left `on_hand`).

Given that model, the movements are:

| Event | Movement type | onHand | quarantined | damaged | Δ available | Rationale |
|---|---|---:|---:|---:|---:|---|
| Return received | `RETURN_RECEIPT` | **+q** | **+q** | 0 | 0 | Enters the primary pool but held — sellable availability unchanged. |
| RESTOCK | `RETURN_RESTOCK` | 0 | −q | 0 | **+q** | Release the hold; stock stays in the pool and becomes sellable. |
| DAMAGED | `DAMAGE` | **−q** | −q | **+q** | 0 | Move out of the primary pool into the damaged pool; clear the hold. |
| RETURN_TO_SUPPLIER | `SUPPLIER_RETURN` | −q | −q | 0 | 0 | Ships out of the building; clear the hold. |
| DISPOSE | `RETURN_DISPOSE` | −q | −q | 0 | 0 | Scrapped out of the building; clear the hold. |

**⚠ Deliberate deviation from the brief's example — flagged.** The brief modelled DAMAGED as
`quarantined −q, damaged +q` with `on_hand` unchanged. In *this* engine `damaged` lives **outside**
`on_hand` (that is how every existing `DAMAGE`/`EXPIRY` movement already behaves, and it is why the
availability formula does not subtract `damaged`). Leaving `on_hand` unchanged would leave the damaged
units **double-counted inside `on_hand` and wrongly counted as available**. So DAMAGED here also carries
`on_hand −q`. Net availability is identical to the brief (Δ = −q −(−q) = 0); only the physical pool is
kept honest. The alternative — redefining `available` to subtract `damaged` and rewriting the existing
`DAMAGE`/`EXPIRY` semantics — was rejected as a larger, riskier change to already-shipped ledger rules.

Worked example (matches the brief's, corrected for this engine):

```
Return 10 :  on_hand +10, quarantined +10        → on_hand 10, quar 10, dmg 0, available 0
Restock 7 :  quarantined  −7                      → on_hand 10, quar  3, dmg 0, available 7
Damaged 2 :  on_hand −2, quarantined −2, dmg +2   → on_hand  8, quar  1, dmg 2, available 7
Dispose 1 :  on_hand −1, quarantined  −1          → on_hand  7, quar  0, dmg 2, available 7
```

All 10 traceable: 7 sellable on hand, 2 in the damaged pool, 1 gone.

### New movement types

`RETURN_RECEIPT`, `RETURN_RESTOCK`, `RETURN_DISPOSE` are added to `MovementType`. DAMAGED and
RETURN_TO_SUPPLIER **reuse** the existing `DAMAGE` and `SUPPLIER_RETURN` types but post **explicit bucket
deltas** (the returned stock comes *from quarantine*, unlike a direct write-off), because the deltas — not
the type's default — are the source of truth. Intake uses **one** origin-agnostic type for every document
type; the CUSTOMER/SUPPLIER/INTERNAL origin is metadata on the document, not a movement-type distinction.

## Data model

Naming follows the existing ledger grain: **`productId` + `variantId`** (NIL-UUID sentinel for base
product), Decimal(18,4) — *not* a combined `productVariantId` (kept for consistency with balances,
movements, and reservations; a technical decision recorded here).

```
InventoryReturn
  id, organizationId, returnNo (unique per org), type, warehouseId,
  sourceReference?, status, reason?, notes?,
  createdById?, createdAt, receivedAt?, completedAt?

ReturnLine
  id, returnId, productId, variantId (NIL=base), locationId?,
  quantity          -- declared/expected at DRAFT
  receivedQuantity  -- actually taken into quarantine at RECEIVE (default = quantity)
  disposedQuantity  -- running total drawn out of quarantine by all dispositions

ReturnDisposition            -- one row per decision; a line may split across many
  id, returnLineId, type, quantity, reason?, notes?, performedById, performedAt
```

`ReturnType = CUSTOMER | SUPPLIER | INTERNAL`.
`DispositionType = RESTOCK | DAMAGED | RETURN_TO_SUPPLIER | DISPOSE`.

Remaining-in-quarantine for a line = `receivedQuantity − disposedQuantity`. (`disposedQuantity` counts
**every** disposition, RESTOCK included — it means "quarantine drawn down", not "scrapped".)

The full schema (including `ReturnDisposition`) is created in the **2B.2A** migration to avoid churn,
even though disposition endpoints ship in 2B.2B.

## Lifecycle & transitions

```
DRAFT               → RECEIVED | CANCELLED
RECEIVED            → PARTIALLY_DISPOSED | COMPLETED
PARTIALLY_DISPOSED  → COMPLETED
COMPLETED           → (terminal)
CANCELLED           → (terminal)
```

- **Cancel only before receipt** — a `RECEIVED`/`PARTIALLY_DISPOSED`/`COMPLETED` return cannot be cancelled.
- **Received/completed returns are immutable** — lines cannot be edited or added after `RECEIVED`.
- A return becomes `COMPLETED` automatically when every line's `disposedQuantity == receivedQuantity`;
  the first disposition that does not complete it moves `RECEIVED → PARTIALLY_DISPOSED`.

## Invariants (enforced + tested)

1. `quantity > 0` on every draft line; `receivedQuantity > 0` on every received line.
2. A disposition's `quantity ≤` the line's remaining quarantined (`receivedQuantity − disposedQuantity`).
3. Total dispositions on a line can never exceed its `receivedQuantity`.
4. **Return receipt is idempotent** (re-posting does not re-add to quarantine).
5. **Disposition posting is idempotent** (re-posting does not double-move).
6. `quarantined` may never become negative.
7. `damaged` may never become negative.
8. Cancel is allowed **only** before receipt.
9. Received/completed returns are immutable.
10. An inactive/archived product or warehouse cannot be used for **new** return intake.
11. Historical returns remain fully readable after later product/warehouse archival.

Idempotency reuses the ledger's `idempotencyKey` (unique per org) + `referenceType`/`referenceId`
grouping (`referenceType = 'inventory_return'`, `referenceId = return id`), exactly as receiving/releases
already do.

## Permissions

```
return.view      -- see returns
return.create    -- create/edit a DRAFT return
return.receive   -- receive returned stock into quarantine
return.inspect   -- inspect + RESTOCK (light operational access)
return.dispose   -- destructive outcomes: DAMAGED, RETURN_TO_SUPPLIER, DISPOSE
```

RESTOCK is gated by `return.inspect`; the destructive outcomes require `return.dispose`. Seeded into
system roles: warehouse staff get view/create/receive/inspect; managers and admin additionally get
`return.dispose`.

## Deferred scope (explicit)

**No batch/serial-specific return handling in 2B.2.** True lot/serial traceability belongs in Phase 2C.
The line grain already carries no batch/serial columns, so there are no half-built hooks to leave behind —
we simply do not add them now.

## Slices

- **2B.2A — Return Intake:** documents (CUSTOMER/SUPPLIER/INTERNAL), DRAFT → RECEIVE into quarantine via
  `RETURN_RECEIPT`, cancel-before-receipt, immutability after receipt, lifecycle + audit. (Backend; full
  schema + migration land here.)
- **2B.2B — Inspection + Disposition:** inspect quarantined stock and split it across RESTOCK / DAMAGED /
  RETURN_TO_SUPPLIER / DISPOSE, each an immutable posting; `ReturnDisposition` records; status roll-up.
- **2B.2C — UX + Visibility:** operational screens, quarantine breakdown + stock drill-down, filters,
  disposition history.

## Definition of done (2B.2)

> An authorized operator can record returned physical stock into quarantine, inspect it, split it across
> valid disposition outcomes, and trace every resulting quantity change through immutable ledger movements
> without making quarantined stock prematurely available.
