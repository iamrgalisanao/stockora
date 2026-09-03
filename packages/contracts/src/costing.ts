/**
 * FIFO costing (Phase 2D.5, ADR 0013). Cost layers are valuation state over the same quantity ledger; WAC
 * and FIFO are strategies over identical physical movements. Every cost figure is cost.view-gated.
 */

export const COSTING_STRATEGIES = ['WAC', 'FIFO'] as const;
export type CostingStrategy = (typeof COSTING_STRATEGIES)[number];

export const COST_LAYER_STATUSES = ['OPEN', 'DEPLETED'] as const;
export type CostLayerStatus = (typeof COST_LAYER_STATUSES)[number];

export interface CostingPolicyResponse {
  /** null = the organization default; otherwise a per-product override. */
  productId: string | null;
  strategy: CostingStrategy;
  configured: boolean; // false when this is the built-in WAC default
}

export interface CostLayerResponse {
  id: string;
  productId: string;
  productSku: string;
  variantId: string | null;
  warehouseId: string;
  warehouseCode: string;
  sourceMovementId: string;
  receivedQuantity: string;
  remainingQuantity: string;
  unitCost: string;
  receivedAt: string;
  status: CostLayerStatus;
}

export interface CostLayerConsumptionResponse {
  id: string;
  costLayerId: string;
  outboundMovementId: string;
  quantity: string;
  unitCost: string;
  extendedCost: string;
}

/** WAC-vs-FIFO valuation for one (product, variant, warehouse) scope. */
export interface CostValuationRow {
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  warehouseId: string;
  warehouseCode: string;
  strategy: CostingStrategy;
  onHand: string;
  wacUnitCost: string;
  wacValue: string;
  fifoLayerQuantity: string;
  fifoValue: string;
}
