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

/** One ledger event affecting a lot, with its source document resolved (lot movement timeline). */
export interface LotMovementRow {
  id: string;
  occurredAt: string;
  movementType: string;
  warehouseId: string;
  warehouseCode: string;
  onHandDelta: string;
  reservedDelta: string;
  inTransitDelta: string;
  quarantinedDelta: string;
  damagedDelta: string;
  documentType: string | null; // reference type, e.g. goods_receipt / stock_release
  documentId: string | null;
  documentReference: string | null; // human number (GR-… / REL-… / …), or a label for non-document events
  actorId: string | null;
}

/** A selectable lot for an operational workflow at a specific warehouse (the shared picker contract). */
export interface PickableLot {
  lotId: string;
  lotNumber: string;
  status: LotStatus;
  origin: LotOrigin;
  expiryDate: string | null;
  onHand: string;
  reserved: string;
  quarantined: string;
  available: string; // onHand - reserved - quarantined at this warehouse
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
