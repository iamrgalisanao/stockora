# Phase 2D.4B — Scorecards + Trends

**Status: ✅ Complete.** Second slice of 2D.4 Supplier Analytics. Builds on the 2D.4A read model **without
changing any metric definition** — the same single scoring engine now drives org-weighted scores,
period-over-period trends, per-product breakdown, and an advisory preferred-vs-observed comparison. No new ADR.

## Organization score weights

`SupplierAnalyticsPolicy` (one row per org) persists **relative** weights — they need not sum to 1. The
scorer renormalizes at calculation time over the metrics each supplier actually has data for, so a supplier
with only fill + price data is scored on those two in their **configured proportions**, never penalized for
missing instrumentation. Validation: each weight ≥ 0, at least one > 0.

- `GET /analytics/suppliers/policy` (`report.view`) · `PUT /analytics/suppliers/policy` (`settings.manage`).
- Every score component is returned fully explained: `{ rawMetric, subScore, configuredWeight, appliedWeight }`
  — so "91.4" is always reconstructable, and a dropped metric shows `appliedWeight = 0` rather than a silent
  zero sub-score.

## Period-over-period trends

`GET /analytics/suppliers/:id/scorecard` compares the selected window against the **immediately-preceding
equal-length period**. Each of overall score, fill rate, on-time, lead time, price variance, and reject rate
returns `{ current, previous, delta, deltaPct, higherIsBetter, currentCoveragePct, previousCoveragePct }`.

- `higherIsBetter` is **false** for lead time, price variance, and reject rate — the UI colours direction by
  this flag, so a numeric rise is not blindly green.
- Coverage travels **separately** alongside each value, so an apparent dip that is really improved
  measurement (e.g. on-time 92% at 80% coverage vs 95% at 20% coverage) is visible, not misread.

## Product breakdown

The scorecard's `products[]` runs the **same engine** grouped by (supplier, product); it reconciles to the
supplier aggregate (Σ product received = aggregate received) and preserves every metric definition. No second
scoring implementation.

## Preferred-vs-observed comparison (advisory)

`GET /analytics/suppliers/preferred-comparison` uses the **authoritative** `InventoryPolicy.preferredSupplierId`
(per product/warehouse) — never the descriptive `Supplier.isPreferred` flag. For each preference it computes,
from comparable warehouse-scoped data, the preferred supplier's score and the best observed supplier's score,
and the difference. It is **advisory only** — it never rewrites the stored preference.

## Sample size

Each row carries `receiptsCount`, `linesCount`, and (via coverage) expected-quantity coverage, plus a
non-scoring `sampleLabel` (`LOW_SAMPLE` < 5 receipts, `MODERATE_SAMPLE` 5–19, `HIGH_SAMPLE` ≥ 20) so a
two-receipt score doesn't visually carry the confidence of a two-hundred-receipt one. Informational, not a
hidden scoring modifier.

## UI

- **Comparison page** gains a score-weights editor (relative weights, live recalculation), a
  preferred-vs-observed panel (Δ badge, advisory note), sample labels, and supplier rows linking to the scorecard.
- **Supplier scorecard** page: overall score + sample size, trend-vs-prior cards (direction-aware arrows,
  coverage movement), an explainable score-components table, and the per-product breakdown.

## Tests

`test/supplier-scorecards.e2e-spec.ts` (5): org custom weights applied + renormalized (need not sum to 1);
all-zero rejected + policy org-isolation; equal-length trend windows with correct deltas + lower-is-better
direction metadata + separate coverage; product breakdown reconciles to the aggregate + sample counts;
preferred comparison uses the authoritative `preferredSupplierId`, ignores `Supplier.isPreferred`, picks the
best observed from scoped data, and never rewrites the preference. Full suite green (50 suites / 361 tests);
browser-verified the scorecard (score components, trend/coverage cards, product breakdown) and the weights
editor.

## Definition of done

> An organization can configure how supplier performance is weighted, compare current performance against an
> equivalent prior period, understand performance by product, and see whether operationally preferred
> suppliers remain competitive — with every score still transparent, coverage-aware, and advisory rather than
> self-modifying. ✅

**Next:** 2D.4C — richer UX (dashboard, charts/trends over time, drill-down to receipts/returns).
