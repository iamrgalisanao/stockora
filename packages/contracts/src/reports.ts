/**
 * Report contracts (Phase 20). Accurate over the current ledger/balances + WAC.
 * `value` fields are gated by valuation.view.
 */

export const VALUATION_GROUPINGS = ['warehouse', 'category', 'brand'] as const;
export type ValuationGrouping = (typeof VALUATION_GROUPINGS)[number];

export interface ValuationRow {
  key: string; // group id/code (or 'uncategorized')
  label: string;
  onHand: string;
  value: string;
}

export interface ValuationReport {
  groupBy: ValuationGrouping;
  rows: ValuationRow[];
  totalValue: string;
}

export type StockStatus = 'OUT' | 'LOW' | 'OVERSTOCK' | 'OK';

export interface StockStatusRow {
  productId: string;
  sku: string;
  name: string;
  onHand: string;
  available: string;
  reorderPoint: string;
  maxStock: string;
  status: StockStatus;
}

export interface DeadStockRow {
  productId: string;
  sku: string;
  name: string;
  onHand: string;
  value?: string; // gated by valuation.view
  lastOutboundAt: string | null;
  daysSinceOutbound: number | null; // null = never issued
}
