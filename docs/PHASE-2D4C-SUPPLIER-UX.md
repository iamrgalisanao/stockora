# Phase 2D.4C — Supplier Analytics UX

**Status: ✅ Complete.** Final slice of 2D.4. Presentation + drill-down over the frozen 2D.4A/B engine — **no
new scoring rules**. Every time bucket and every drilled record uses the exact same metric definitions as the
scorecard. **This completes 2D.4 Supplier Analytics.**

## Time-series trends

`GET /analytics/suppliers/:id/trends` buckets the same engine over time, choosing granularity deterministically
from the range: **≤ 31 days → daily**, **32–180 → weekly**, **> 180 → monthly**. Each bucket carries the full
metric set (score, fill, on-time, lead time, price variance, reject rate) plus its **coverage** and
`receiptsCount`/`linesCount`, and the response repeats the direction metadata (`higherIsBetter` — false for
lead time, price variance, reject rate) so lower-is-better metrics render correctly. Buckets reconcile to the
scorecard (Σ bucket receipts = scorecard receipts; a bucket's metric equals the aggregate over its receipts).

## Metric evidence / drill-down

`GET /analytics/suppliers/:id/evidence?metric=FILL_RATE|ON_TIME|LEAD_TIME|PRICE|QUALITY` returns the **exact
records** in a metric's numerator/denominator, with `{ numerator, denominator, value }` that reconciles to the
displayed metric — the direct answer to "why is this supplier only 72%?". Each record links to its goods
receipt. Only qualifying records are returned (on-time excludes undated receipts; lead time needs an order
date; fill rate needs a known expected qty; price needs a reference cost; quality is rejected quantities).
**Price drill-down is gated by `cost.view`** (it exposes unit cost vs reference cost); other metrics stay open
to any `report.view` user. Records remain drillable after product archival, and the whole read model stays
org- and warehouse-scoped.

## UI

- **Dashboard** (comparison page): a KPI summary (avg score / on-time / fill / lead time / reject rate, each
  averaged only over suppliers with that metric), a **sortable** ranking (any major metric; **missing values
  always sort last, never as zero**), the coverage panel, the weights editor, and the advisory
  preferred-vs-observed panel with a "View comparison" path — never an auto-change button.
- **Supplier scorecard**: overview + prior-period trend cards, the score-components table, product breakdown,
  a **Trends** section (compact inline-SVG charts per metric, with a dashed coverage line for measurement
  quality and a lower/higher-is-better caption), and a **Performance evidence** panel (metric selector →
  reconciled numerator/denominator → the itemized records, each linking to its receipt). The sparse-data
  reality is kept prominent (sample size + coverage everywhere).

## Tests

`test/supplier-analytics-ux.e2e-spec.ts` (5): trend buckets reconcile to the scorecard + carry direction
metadata + per-bucket coverage/sample; on-time evidence includes only dated receipts and reconciles
numerator/denominator to the metric; fill-rate evidence reconciles and respects the product filter; price
drill-down is `cost.view`-gated (viewer 403, admin sees cost detail) while a non-cost metric stays open; a
missing metric stays null (not zero) and evidence stays drillable after product archival and is org-isolated.
Full suite green (51 suites / 366 tests); browser-verified the KPI summary, sortable ranking, trend charts,
and the fill-rate evidence drill-down to source receipts.

## Definition of done

> An authorized user can identify supplier performance trends, compare suppliers visually, understand the
> quality and coverage of the underlying data, and drill every major metric back to the operational records
> that produced it. ✅

**2D.4 Supplier Analytics is complete** (2D.4A read model, 2D.4B scorecards + trends, 2D.4C UX). Next: 2D.5 —
FIFO Costing.
