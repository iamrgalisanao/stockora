# ADR 0013 — FIFO Costing (Phase 2D.5)

**Status:** Accepted · **Date:** 2026-09-04 · **Related:** [0007 Batch/Lot](0007-batch-lot-tracking.md),
[0008 Expiry/FEFO](0008-expiry-fefo.md), [0012 Serial Tracking](0012-serial-tracking.md), Phase 0 §6/§8/§10
(the append-only ledger + balance projection + moving-average cost).

## Context

Inventory value today is a single **moving weighted average** (WAC) held as `InventoryBalance.avgCost` and
stamped onto each movement. Some businesses need **FIFO** — outbound value consumes the oldest purchase costs
first. FIFO introduces persistent **cost layers** alongside the existing WAC path. This is a semantic-boundary
change to how *value* is determined; it must not disturb how *quantity* is governed.

## Central principle

> **Quantity stays ledger-authoritative; cost is a valuation projection over the same physical movements.**
> FIFO and WAC are two **costing strategies** over one append-only quantity ledger. A cost layer is
> **valuation state, not inventory identity**, and posted costs are **immutable** — corrections are new
> reversal/compensating movements, never edits.

## Core decisions

**1. Cost layers are per (org, product, variant, warehouse) — not per lot, not per movement grain.** A
receipt movement that raises on-hand **opens one cost layer**; a lot may span several layers and a layer is
independent of any lot. FIFO is **warehouse-specific** (v1): value physically transferred carries with the
stock rather than recosting against the destination's history.

```
CostLayer
- id, organizationId, productId, variantId (NIL sentinel), warehouseId
- sourceMovementId            (the inflow movement that opened it)
- receivedQuantity, remainingQuantity, unitCost
- receivedAt, status          (OPEN | DEPLETED)

CostLayerConsumption
- id, costLayerId, outboundMovementId
- quantity, unitCost, extendedCost   (immutable record of what an outbound consumed)
```

**2. Strategy is explicit and stored, org-default with optional per-product override.**
```
CostingStrategy = WAC | FIFO
CostingPolicy { organizationId, productId (NIL = org default), strategy }
```
`strategyFor(org, product)` = product row → org-default row → `WAC`. **WAC is the default and its behavior is
unchanged.**

**3. Switching strategy requires zero physical stock** for the scope, or an explicit migration/revaluation
(deferred). We never flip WAC→FIFO mid-stock and pretend historical layers exist — the upsert is rejected
when on-hand ≠ 0 for the affected product(s). (Guard lands with 2D.5A; a real revaluation workflow is later.)

**4. Costing rides `applyMovement`, inside the same transaction as the quantity posting.** The strategy hook
runs where the movement is written, so value and quantity commit atomically and inherit the ledger's
idempotency (a replayed post short-circuits before any layer is touched — no double consumption).
- **Inflow that opens basis** (`OPENING_BALANCE`, `PURCHASE_RECEIPT`) under FIFO → open a `CostLayer`
  (`unitCost` = the received unit cost; `remaining = receivedQty`). WAC's `avgCost` blend still runs (harmless;
  it keeps WAC reporting available and is authoritative for WAC products).
- **Outflow that expenses value** (`SALES_RELEASE`, and — in 2D.5B — adjustment-out / damage / dispose /
  negative count variance) under FIFO → **consume layers oldest-first**, set the outbound movement's
  `unitCost`/`totalCost` to the consumed COGS, and write `CostLayerConsumption` rows.

**5. FIFO allocation is deterministic and locked.** Order strictly by `receivedAt ASC, id ASC`; select
`FOR UPDATE` so concurrent releases cannot consume the same remaining quantity or over-consume. Insufficient
layer quantity fails safely (the release does not partially cost).

**6. FIFO is not FEFO.** FEFO (ADR 0008) chooses which *physical lot* to ship; FIFO chooses which *cost basis*
is consumed. They may select differently and that is correct — cost consumption is by layer age, independent
of the lot the physical pick drew from.

**7. Movement-type semantics for value (locked; 2D.5A implements receipt + release, 2D.5B the rest).**
```
Receipt / opening balance   → open a cost layer
Release / issue             → consume FIFO layers (COGS)
Transfer                    → cost MOVES, not expensed: consume at source, re-open the SAME cost
                              components at the destination (preserve basis) — 2D.5B
Return (customer)           → restore original issued cost basis where identifiable; explicit fallback
                              otherwise — 2D.5B
Adjustment IN               → requires an explicit unit cost / policy cost source; opens a layer — 2D.5B
Adjustment OUT / damage /
  dispose                   → consume FIFO layers (value leaves usable inventory) — 2D.5B
Physical count −variance    → consume FIFO layers; +variance needs an explicit valuation policy — 2D.5B
```

**8. Valuation.** For a FIFO scope, inventory value = **Σ remaining-layer value** (`Σ remaining × unitCost`);
a movement's outbound cost = **Σ its layer consumptions**. For WAC, value = `onHand × avgCost` (unchanged).
Both are computable side-by-side for a WAC-vs-FIFO comparison. All cost figures are **`cost.view`-gated**.

**9. Immutability + corrections.** Layers and consumptions are append-only. A posted cost is never edited; a
correction reverses the movement (Phase 0 §10, §21), which — in 2D.5B — restores the consumed layer
quantities via compensating consumption records. 2D.5A does not special-case reversals beyond leaving the WAC
reversal path intact.

## Slices

- **2D.5A — FIFO Core:** this ADR; `CostLayer` + `CostLayerConsumption` + `CostingPolicy` schema; the strategy
  abstraction + resolution; receipt layer creation; outbound FIFO consumption with `FOR UPDATE` locking and
  inherited idempotency; the zero-stock switch guard; valuation + cost-layer queries. WAC path untouched.
- **2D.5B — Propagation:** transfers preserve cost basis; returns restore original basis; adjustments;
  damage/disposal; counts; strategy-migration/revaluation guards.
- **2D.5C — UX + Reporting:** costing policy UI; cost-layer explorer; FIFO valuation report; movement cost
  drill-down; WAC-vs-FIFO comparison.

## Mandatory invariants (2D.5A, tested)

A receipt creates exactly one cost layer; multiple receipts create independent layers; FIFO consumes the
oldest layer first; a single release spans multiple layers with the correct blended COGS; remaining
quantities reconcile to on-hand; concurrent releases cannot over-consume a layer; a replayed release does not
duplicate consumption; insufficient cost-layer quantity fails safely; the WAC path is unchanged for WAC
products; FIFO valuation equals Σ remaining-layer value; a movement's cost equals Σ its layer consumptions;
`cost.view` gates every cost figure.

## Definition of done (2D.5)

> For FIFO-configured inventory, every outbound quantity consumes an immutable, deterministic sequence of
> historical cost layers, while physical inventory remains governed by the existing ledger and
> transfers/returns preserve cost basis without corrupting WAC behavior.
