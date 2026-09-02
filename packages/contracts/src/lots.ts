/**
 * Batch/lot contracts (2C.1, ADR 0007). A lot is physical traceability identity for a product — not
 * master data and not a cost layer. Decimal quantities are strings. Lot-level balances reconcile to the
 * ledger and sum to the product/warehouse totals.
 */

export const LOT_STATUSES = ['ACTIVE', 'CLOSED', 'ARCHIVED'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const LOT_ORIGINS = ['RECEIPT', 'OPENING', 'LEGACY_MIGRATION'] as const;
export type LotOrigin = (typeof LOT_ORIGINS)[number];

/** Per-warehouse balance for a lot (the stock-by-lot breakdown). */
export interface LotStockRow {
  warehouseId: string;
  warehouseCode: string;
  onHand: string;
  reserved: string;
  quarantined: string;
  damaged: string;
  inTransit: string;
  available: string; // onHand - reserved - quarantined
}

export interface LotResponse {
  id: string;
  lotNumber: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  manufacturedAt: string | null;
  expiryDate: string | null;
  receivedAt: string | null;
  supplierId: string | null;
  status: LotStatus;
  origin: LotOrigin;
  createdAt: string;
  // Totals summed across all warehouses (the lot's global physical position).
  onHand: string;
  reserved: string;
  quarantined: string;
  damaged: string;
  inTransit: string;
  /** Per-warehouse breakdown — present on the detail read, omitted from list rows. */
  stock?: LotStockRow[];
}
