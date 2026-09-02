/**
 * Stock transfer contracts (Phase 12). Flow: DRAFT → FOR_APPROVAL → APPROVED →
 * IN_TRANSIT (dispatched) → RECEIVED. In-transit is held at the source until receipt.
 */

export const TRANSFER_STATUSES = [
  'DRAFT',
  'FOR_APPROVAL',
  'APPROVED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export interface TransferItemResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  quantity: string;
  qtyDispatched: string;
  qtyReceived: string;
  remarks: string | null;
}

export interface TransferResponse {
  id: string;
  transferNumber: string;
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  destWarehouseId: string;
  destWarehouseCode: string;
  reference: string | null;
  status: TransferStatus;
  notes: string | null;
  requestorId: string | null;
  approvedById: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: TransferItemResponse[];
}

export interface TransferListItem {
  id: string;
  transferNumber: string;
  sourceWarehouseCode: string;
  destWarehouseCode: string;
  status: TransferStatus;
  createdAt: string;
  lineCount: number;
}
