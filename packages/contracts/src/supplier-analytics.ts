/**
 * Supplier performance analytics (2D.4). A read model over posted goods receipts — every figure traces back
 * to operational records, and any metric lacking its input is reported as coverage, never guessed.
 */

export const SUPPLIER_SCORE_WEIGHT_KEYS = ['fillRate', 'onTime', 'leadTime', 'price', 'quality'] as const;
export type SupplierScoreWeightKey = (typeof SUPPLIER_SCORE_WEIGHT_KEYS)[number];
export type SupplierScoreWeights = Record<SupplierScoreWeightKey, number>;

/** Default v1 weights (org-configurable in 2D.4B). Sum to 1.0. */
export const DEFAULT_SUPPLIER_SCORE_WEIGHTS: SupplierScoreWeights = {
  fillRate: 0.25,
  onTime: 0.2,
  leadTime: 0.2,
  price: 0.2,
  quality: 0.15,
};

/** One metric's contribution to the overall score — fully explainable (2D.4B). */
export interface SupplierScoreComponent {
  key: SupplierScoreWeightKey;
  label: string;
  rawMetric: number | null; // the underlying metric value (fillRatePct, priceVariancePct, …)
  subScore: number | null; // 0–100 normalized; null when the metric has no coverage/benchmark
  configuredWeight: number; // the org/default relative weight as configured
  appliedWeight: number; // renormalized weight actually used; 0 when the metric was dropped
}

export const SAMPLE_LABELS = ['LOW_SAMPLE', 'MODERATE_SAMPLE', 'HIGH_SAMPLE'] as const;
export type SampleLabel = (typeof SAMPLE_LABELS)[number];

export interface SupplierCoverage {
  fillRatePct: number; // % of lines with a known expected quantity
  onTimePct: number; // % of receipts with an expected delivery date
  leadTimePct: number; // % of receipts with a recorded order date
  pricePct: number; // % of received quantity with a supplier reference cost
}

export interface SupplierPerformanceRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  isPreferred: boolean;
  /** Present on a per-product breakdown row (2D.4B); null on an aggregate supplier row. */
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  receiptsCount: number;
  linesCount: number;
  sampleLabel: SampleLabel;
  orderedQuantity: string;
  receivedQuantity: string;
  rejectedQuantity: string;
  fillRatePct: number | null;
  averageLeadTimeDays: number | null;
  quotedLeadTimeDays: number | null;
  onTimeDeliveryPct: number | null;
  averageUnitCost: string | null;
  priceVariancePct: number | null;
  returnRatePct: number;
  performanceScore: number | null; // 0–100, weighted over AVAILABLE metrics; null if none available
  components: SupplierScoreComponent[];
  coverage: SupplierCoverage;
}

export interface SupplierPerformanceResponse {
  periodStart: string;
  periodEnd: string;
  weights: SupplierScoreWeights;
  /** Org-level coverage across the compared suppliers (adoption of the optional inputs). */
  coverage: { onTimePct: number; leadTimePct: number; pricePct: number };
  suppliers: SupplierPerformanceRow[];
}

/** Org-configurable relative weights (2D.4B). Persisted as-is; renormalized at calculation time. */
export interface SupplierAnalyticsPolicyResponse {
  fillRate: number;
  onTime: number;
  leadTime: number;
  price: number;
  quality: number;
  configured: boolean; // false when these are the built-in defaults
}

/** One metric compared to the immediately-preceding equal-length period (2D.4B). */
export interface MetricTrend {
  key: string;
  label: string;
  higherIsBetter: boolean; // false for lead-time, price variance, and reject rate
  current: number | null;
  previous: number | null;
  delta: number | null; // current − previous (null if either side is absent)
  deltaPct: number | null;
  currentCoveragePct: number; // measurement quality alongside the value
  previousCoveragePct: number;
}

export interface SupplierScorecardResponse {
  period: { start: string; end: string };
  previousPeriod: { start: string; end: string };
  weights: SupplierScoreWeights;
  supplier: SupplierPerformanceRow; // current-period aggregate
  trends: MetricTrend[]; // overall score + each metric, each coverage-aware and direction-tagged
  products: SupplierPerformanceRow[]; // per-product breakdown, same period, reconciles to the aggregate
}

/** Advisory preferred-vs-observed comparison (2D.4B) — never rewrites the stored preference. */
export interface PreferredSupplierComparisonRow {
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  warehouseId: string;
  warehouseCode: string;
  preferredSupplierId: string;
  preferredSupplierName: string;
  preferredScore: number | null;
  bestSupplierId: string | null;
  bestSupplierName: string | null;
  bestScore: number | null;
  difference: number | null; // bestScore − preferredScore (positive ⇒ an alternative is outperforming)
}
export interface PreferredSupplierComparisonResponse {
  period: { start: string; end: string };
  rows: PreferredSupplierComparisonRow[];
}
