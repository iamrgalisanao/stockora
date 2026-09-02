/**
 * Inventory ledger + balance read contracts (Phase 07-08). Quantities and money are
 * strings (decimal precision). `avgCost`/`value` are gated by cost.view / valuation.view.
 */

export interface BalanceResponse {
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  lotId: string | null; // ADR 0007 — null for non-batch stock
  warehouseId: string;
  warehouseCode: string;
  onHand: string;
  reserved: string;
  inTransit: string;
  quarantined: string;
  damaged: string;
  available: string; // onHand - reserved - quarantined
  avgCost?: string; // gated by cost.view
  value?: string; // onHand * avgCost, gated by valuation.view
}

export interface MovementResponse {
  id: string;
  txnNumber: string;
  movementType: string;
  isReversal: boolean;
  productId: string;
  productSku: string;
  variantId: string | null;
  lotId: string | null;
  warehouseId: string;
  warehouseCode: string;
  quantity: string;
  onHandDelta: string;
  reservedDelta: string;
  inTransitDelta: string;
  quarantinedDelta: string;
  damagedDelta: string;
  unitCost?: string; // gated by cost.view
  totalCost?: string; // gated by cost.view
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  performedById: string | null;
  postedAt: string;
}

export interface StockCardEntry {
  postedAt: string;
  txnNumber: string;
  movementType: string;
  referenceType: string | null;
  referenceId: string | null;
  in: string; // on-hand increase (0 if none)
  out: string; // on-hand decrease (0 if none)
  balance: string; // running on-hand after this movement
}

export interface StockCardResponse {
  productId: string;
  productSku: string;
  warehouseId: string | null;
  entries: StockCardEntry[];
  closingBalance: string;
}

export interface ReconciliationDrift {
  productId: string;
  variantId: string | null;
  warehouseId: string;
  bucket: string;
  projected: string;
  ledger: string;
}

export interface ReconciliationResult {
  balancesChecked: number;
  drift: ReconciliationDrift[];
  ok: boolean;
}
