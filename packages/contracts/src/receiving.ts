/** Goods receiving contracts (Phase 10). `unitCost` fields are gated by cost.view. */

export const RECEIPT_STATUSES = [
  'DRAFT',
  'RECEIVING',
  'FOR_INSPECTION',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface ReceiptItemResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  expectedQty: string;
  receivedQty: string;
  rejectedQty: string;
  unitCost?: string; // gated by cost.view
  batchNumber: string | null;
  expiryDate: string | null;
  locationId: string | null;
  remarks: string | null;
  /** Per-unit serial numbers captured on the line for a serialized product (ADR 0012). */
  serialNumbers: string[];
}

export interface ReceiptResponse {
  id: string;
  receiptNumber: string;
  supplierId: string | null;
  supplierName: string | null;
  warehouseId: string;
  warehouseCode: string;
  purchaseOrderRef: string | null;
  deliveryReceiptRef: string | null;
  supplierInvoiceRef: string | null;
  receivingDate: string;
  status: ReceiptStatus;
  notes: string | null;
  postedAt: string | null;
  createdAt: string;
  items: ReceiptItemResponse[];
}

export interface ReceiptListItem {
  id: string;
  receiptNumber: string;
  supplierName: string | null;
  warehouseCode: string;
  status: ReceiptStatus;
  receivingDate: string;
  lineCount: number;
}
