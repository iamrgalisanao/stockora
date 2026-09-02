import type { EntityStatus } from './catalog';

/** Warehouse-level stock-maintenance policy (Phase 2A.1C). */
export interface InventoryPolicyResponse {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  minStock: string;
  maxStock: string | null;
  reorderPoint: string;
  reorderQuantity: string;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  status: EntityStatus;
}

/** Derived reorder state (never persisted). */
export const REORDER_STATES = [
  'OK',
  'LOW_STOCK',
  'REORDER_REQUIRED',
  'INBOUND_COVERED',
  'OVERSTOCK',
  'OUT_OF_STOCK',
] as const;
export type ReorderState = (typeof REORDER_STATES)[number];

/** One authoritative assessment for a (warehouse, product, variant). */
export interface ReorderAssessment {
  warehouseId: string;
  warehouseCode: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  uomCode: string;
  onHand: string;
  reserved: string;
  available: string;
  inTransit: string;
  minStock: string;
  reorderPoint: string;
  maxStock: string | null;
  recommendedQuantity: string;
  state: ReorderState;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  estimatedCost?: string; // gated by cost.view (recommendedQuantity × unit cost)
}
