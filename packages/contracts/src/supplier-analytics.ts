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

/** One metric's contribution to the overall score — `subScore` is null when the metric has no coverage. */
export interface SupplierScoreComponent {
  key: SupplierScoreWeightKey;
  label: string;
  subScore: number | null;
  weight: number; // the (renormalized) weight actually applied; 0 when the metric was dropped
}

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
  receiptsCount: number;
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
