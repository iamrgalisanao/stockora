# Phase 2D.5B - FIFO Propagation

**Status: Complete.** Second slice of 2D.5 ([ADR 0013](adr/0013-fifo-costing.md)). FIFO value now follows the
business meaning of each physical movement: preserve basis for transfers, restore traceable return basis,
consume value exactly once when stock leaves inventory value, and require explicit valuation for new positive
inflows.

## Movement semantics

- **Transfers** preserve the exact dispatch composition. A `TRANSFER_OUT` consumes FIFO layers at the source;
  `TRANSFER_IN` recreates destination layers from those same cost components rather than a weighted-average
  layer. Dispatch and receive replay remain idempotent.
- **Serialized returns** restore original issue basis. The issued serial points to its original release
  movement, whose `CostLayerConsumption[]` becomes the return receipt's restored cost basis.
- **Untraceable FIFO returns** are rejected until an explicit valuation source exists. The system does not fall
  back to current WAC, current FIFO, or implicit zero.
- **Negative adjustments, count losses, damage, disposal, supplier returns, expiry, production/project/internal
  consumption** consume FIFO oldest-first and write immutable consumption records.
- **Quarantine/restock** does not consume or create cost basis. Stock remains owned inventory while quarantined.
- **Positive adjustments / count finds** require explicit unit cost and open a new FIFO layer. Zero cost is valid
  only when explicitly entered as zero.

## Implementation

FIFO propagation rides the same `InventoryPostingService.applyMovement` transaction as the quantity ledger.
Callers may pass a `costBasis` for preserved/restored inflows; otherwise FIFO positive inflows must be
explicitly valued. Multi-component basis opens one destination/restored layer per component, preserving FIFO
order for later consumption.

`CostLayerConsumption` remains the immutable record of outbound cost. Transfer receive and traceable returns
reconstruct basis from those consumption rows, so value is never guessed or silently discarded.

## Current return rule

> FIFO return receipt requires attributable historical cost basis. Serialized returns restore the original
> issued basis. Untraceable returns are rejected until an explicit valuation source is provided.

Deferred follow-ups:

- Non-serialized return attribution: restore original basis when a future business flow supplies release/line
  attribution.
- Explicit valuation-source contract: add `EXPLICIT_UNIT_COST / ORIGINAL_COST / APPROVED_POLICY` when multiple
  legitimate positive-inflow valuation sources exist.

## Tests

`test/fifo-costing.e2e-spec.ts` covers:

- transfer preserves exact multi-layer basis
- dispatch replay does not double-consume
- receive replay does not duplicate destination layers
- serialized return restores original issue basis
- quarantine/restock does not duplicate basis
- positive adjustment without valuation is rejected
- negative adjustment consumes oldest FIFO layers and records exact COGS
- count loss consumes FIFO basis
- damage/disposal consume restored FIFO value once without replacement layers
- WAC paths remain unchanged
- FIFO valuation reconciles after covered workflows
- strategy change remains blocked while physical stock exists

Verified with:

```bash
npm.cmd run typecheck
npm.cmd run test:e2e -- fifo-costing.e2e-spec.ts adjustments.e2e-spec.ts counts.e2e-spec.ts return-intake.e2e-spec.ts return-disposition.e2e-spec.ts serial-propagation.e2e-spec.ts --runInBand
```

Result: 6 suites / 56 tests passed.

## Definition of done (2D.5B)

> FIFO-valued inventory preserves historical cost through transfers and returns, consumes cost exactly once
> when value leaves inventory, and creates new cost only through explicit valued inflows, with all resulting
> valuation reconcilable to immutable cost-layer records. Complete.

**Next:** 2D.5C - FIFO UX + Reporting is complete in [PHASE-2D5C-FIFO-UX-REPORTING.md](PHASE-2D5C-FIFO-UX-REPORTING.md).
