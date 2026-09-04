# Phase 2D.5C - FIFO UX + Reporting

**Status: Complete.** Final slice of 2D.5 ([ADR 0013](adr/0013-fifo-costing.md)). FIFO reporting is now
trace-first, aggregate-second: valuation and COGS totals can be explained through the movement, exact
`CostLayerConsumption[]`, and immutable source layer/document history that produced the value.

## Delivered scope

- **Cost Layer Explorer** lists FIFO layers with product, warehouse, status, received quantity, remaining
  quantity, unit cost, remaining value, received date, and source movement/document.
- **Movement Cost Detail** exposes outbound COGS and the exact FIFO layers consumed, including quantity, unit
  cost, extended cost, layer receipt date, and layer source document.
- **Transfer Cost Trace** links a transfer's source movement consumptions to the preserved basis components and
  destination layers created by receive.
- **Return Cost Trace** links serialized return receipts back to the original issued movement and the restored
  return layers.
- **FIFO Valuation / FIFO COGS Reports** provide current FIFO valuation, period FIFO COGS, and WAC comparison
  where both are meaningful.
- **Permissions** remain split: `valuation.view` gates aggregate inventory valuation, while `cost.view` gates
  unit cost, COGS, consumption, transfer trace, return trace, and exportable cost detail.

## API surface

- `GET /inventory/cost-layers` supports product, warehouse, status, and received-date filters and returns
  remaining value plus source document metadata.
- `GET /inventory/cost-layers/:id/trace` returns a layer with its source movement/document.
- `GET /inventory/movements/:id/cost-detail` returns movement COGS and exact layer consumptions.
- `GET /inventory/fifo-cogs` returns a period FIFO COGS report, excluding transfer dispatches because transfer
  value is preserved rather than expensed.
- `GET /inventory/transfers/:id/cost-trace` returns source consumptions and destination layers.
- `GET /inventory/returns/:id/cost-trace` returns serialized issue trace and restored return layers.

## UI

The Costing page now includes:

- strategy controls, preserving the existing zero-stock switch guard
- filterable FIFO cost-layer explorer
- WAC-vs-FIFO valuation report
- FIFO COGS report
- movement, transfer, and return trace lookup panels

The views keep current and historical records readable even when layers are depleted, stock has transferred, or
returned serialized units derive their valuation from an older release.

## Tests

`test/fifo-costing.e2e-spec.ts` covers:

- cost-layer trace exposes source receipt and remaining value
- transfer cost trace preserves source consumption basis and destination layers
- serialized return trace restores the original issued basis
- movement cost detail exposes negative-adjustment FIFO COGS and exact layer consumption
- FIFO COGS report includes count-loss valuation
- cost-only report endpoints reject users without `cost.view`
- valuation and WAC paths remain unchanged

Verified with:

```bash
npm.cmd run typecheck
npm.cmd run test:e2e -- fifo-costing.e2e-spec.ts --runInBand
npm.cmd run test:e2e -- fifo-costing.e2e-spec.ts adjustments.e2e-spec.ts counts.e2e-spec.ts return-intake.e2e-spec.ts return-disposition.e2e-spec.ts serial-propagation.e2e-spec.ts transfers.e2e-spec.ts reports.e2e-spec.ts --runInBand
```

Result: 8 suites / 63 tests passed across FIFO, adjustments, counts, returns, serial propagation, transfers, and
reports.

## Definition of done (2D.5C)

> An authorized user can explain both current FIFO inventory valuation and the cost of any FIFO-valued outbound
> movement by tracing the value back to the historical cost layers that produced it. Complete.

**2D.5 FIFO Costing is complete. Next:** 2D.6 - Mobile Scanner PWA is planned in
[PHASE-2D6-MOBILE-SCANNER-PWA.md](PHASE-2D6-MOBILE-SCANNER-PWA.md), with architecture locked by
[ADR 0014](adr/0014-mobile-scanner-pwa.md).
