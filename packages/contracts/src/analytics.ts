/**
 * Analytics / management-visibility contracts (Phase 17 reorder + Phase 19 dashboard).
 * Decimal fields are strings; `estimatedCost` / `inventoryValue` are gated by cost/valuation.view.
 */

// Reorder recommendations are now warehouse+variant `ReorderAssessment`s (see ./policies).

export interface DashboardSummary {
  totalSkus: number;
  totalOnHand: string;
  totalAvailable: string;
  totalReserved: string;
  totalInTransit: string;
  inventoryValue?: string; // gated by valuation.view
  lowStockCount: number;
  outOfStockCount: number;
  reorderCount: number;
  pending: {
    receipts: number;
    releases: number;
    transfers: number;
    adjustments: number;
    counts: number;
  };
  recentMovements: Array<{
    id: string;
    txnNumber: string;
    movementType: string;
    productSku: string;
    warehouseCode: string;
    quantity: string;
    postedAt: string;
  }>;
}
