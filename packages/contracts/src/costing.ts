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
  remainingValue?: string; // gated by cost.view
  sourceDocument?: CostDocumentRef | null;
}

export interface CostLayerConsumptionResponse {
  id: string;
  costLayerId: string;
  outboundMovementId: string;
  quantity: string;
  unitCost: string;
  extendedCost: string;
}

export interface CostDocumentRef {
  type: string;
  id: string | null;
  number: string | null;
}

export interface CostLayerTraceResponse {
  layer: CostLayerResponse;
  sourceMovement: {
    id: string;
    txnNumber: string;
    movementType: string;
    referenceType: string | null;
    referenceId: string | null;
    postedAt: string;
  };
  sourceDocument: CostDocumentRef | null;
}

export interface CostLayerConsumptionTraceResponse extends CostLayerConsumptionResponse {
  layerReceivedAt: string;
  layerSourceMovementId: string;
  layerSourceDocument: CostDocumentRef | null;
}

export interface MovementCostDetailResponse {
  movement: {
    id: string;
    txnNumber: string;
    movementType: string;
    productId: string;
    productSku: string;
    warehouseId: string;
    warehouseCode: string;
    quantity: string;
    unitCost: string;
    totalCost: string;
    referenceType: string | null;
    referenceId: string | null;
    postedAt: string;
  };
  sourceDocument: CostDocumentRef | null;
  consumptions: CostLayerConsumptionTraceResponse[];
}

export interface TransferCostTraceResponse {
  transfer: CostDocumentRef;
  lines: Array<{
    productId: string;
    productSku: string;
    quantity: string;
    sourceMovementId: string;
    destinationMovementId: string | null;
    sourceConsumptions: CostLayerConsumptionTraceResponse[];
    destinationLayers: CostLayerResponse[];
  }>;
}

export interface ReturnCostTraceResponse {
  return: CostDocumentRef;
  lines: Array<{
    productId: string;
    productSku: string;
    serialNumbers: string[];
    receiptMovementId: string | null;
    originalIssueMovements: Array<{ serialNumber: string; movement: MovementCostDetailResponse['movement'] | null }>;
    restoredLayers: CostLayerResponse[];
  }>;
}

export interface FifoCogsReportResponse {
  from: string | null;
  to: string | null;
  totalCogs: string;
  rows: Array<{
    movementId: string;
    txnNumber: string;
    movementType: string;
    productId: string;
    productSku: string;
    warehouseId: string;
    warehouseCode: string;
    quantity: string;
    totalCost: string;
    postedAt: string;
    sourceDocument: CostDocumentRef | null;
  }>;
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
