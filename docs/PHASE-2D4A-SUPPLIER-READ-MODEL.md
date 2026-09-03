# Phase 2D.4A — Supplier Performance Read Model

**Status: ✅ Complete.** First slice of 2D.4 Supplier Analytics. A read-model analytics capability over
**posted** goods receipts — not a procurement-workflow rewrite. Metric definitions were locked first in
[docs/analytics/SUPPLIER-PERFORMANCE-METRICS.md](analytics/SUPPLIER-PERFORMANCE-METRICS.md); no new ADR.

## Principle

Every figure traces back to posted operational records, and **no metric is invented**: where an input is
missing, the metric is excluded from its denominator and **coverage** is surfaced instead of a
precise-looking but misleading number.

## Metrics (per supplier, over a period)

- **Fill rate** = Σ receivedQty / Σ expectedQty (lines with a known expected qty; blind lines excluded).
- **On-time delivery** = receipts where `receivingDate ≤ expectedDeliveryDate`, over receipts that **have** an
  expected delivery date (undated receipts never silently counted early or late).
- **Lead time** = avg(`receivingDate − orderDate`) over receipts with a recorded order date — labelled
  "order-to-receipt lead time (from recorded order date)"; there is no PO document, so nothing is guessed.
- **Price performance** = quantity-weighted actual unit cost vs the supplier's **quoted `SupplierProduct.cost`**
  (never inventory WAC), as `priceVariancePct`.
- **Quality (return rate)** = Σ rejectedQty / Σ (receivedQty + rejectedQty) — the only supplier-attributable
  return quantity in the model today (reverse-logistics returns carry no supplier link yet).

## Score (transparent, deterministic)

Each metric → a 0–100 sub-score; `performanceScore` is the weighted average **over the metrics a supplier
actually has data for** — a missing metric is dropped and the remaining weights renormalize, never scored
zero. Default weights (org-configurable in 2D.4B): fill-rate 0.25, on-time 0.20, lead-time 0.20, price 0.20,
quality 0.15. The response returns every sub-score and the applied weight, so any score is fully explainable.

## Enabling capture (optional)

The goods receipt gained two **nullable** dates — `orderDate` and `expectedDeliveryDate` — so lead-time and
on-time can be computed where recorded. Adoption shows up as coverage; nothing is back-filled or guessed.
Expected quantity (`expectedQty`) and reference cost (`SupplierProduct.cost`) already existed.

## Scope & isolation

Posted receipts only (`postedAt` set, status `COMPLETED`/`PARTIALLY_RECEIVED`) — draft/cancelled never
contaminate. Filters: period (on `receivingDate`), product, warehouse. Org isolation and the caller's
warehouse scope are always enforced.

## API & UI

- `GET /analytics/suppliers?from&to&productId?&warehouseId?&supplierId?` (`report.view`) →
  `SupplierPerformanceResponse` (per-supplier rows + components + coverage + org-level coverage).
- **Supplier Analytics** page: period / warehouse / product filters, a comparison table (score, fill-rate,
  on-time, lead-time, price variance, return rate, receipts), a coverage banner, and honest "—" for
  metrics without data. The receiving form gained optional order-date / expected-delivery inputs.

## Tests

`test/supplier-analytics.e2e-spec.ts` (8): full metric set + deterministic score (90/100 from a controlled
receipt); determinism + weights normalize to 1; partial-receipt fill rate + unknown-expected exclusion;
on-time denominator excludes undated receipts + late classification; price variance uses the supplier
reference cost (not WAC); a missing metric is dropped (score 100, not dragged to zero) with renormalized
weights; draft/cancelled + out-of-range receipts excluded; product filter + org isolation. Full suite green
(49 suites / 356 tests); browser-verified the populated comparison table with coverage surfacing.

## Definition of done

> An authorized user can objectively compare suppliers over a chosen period using transparent lead-time,
> delivery, fill-rate, price, and quality metrics, with every score traceable back to the underlying
> operational records. ✅ (2D.4A delivers the read model + score + comparison; scorecards/trends land in
> 2D.4B, richer UX in 2D.4C.)
