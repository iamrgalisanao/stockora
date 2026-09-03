/**
 * Serial-tracking contracts (Phase 2D.3, ADR 0012). Unit-level identity as a registry-with-state — one row
 * per physical unit, never a quantity. The ledger stays authoritative; the registry reconciles to it.
 */

export const SERIAL_CAPTURE_MODES = ['RECEIPT', 'ISSUE'] as const;
export type SerialCaptureMode = (typeof SERIAL_CAPTURE_MODES)[number];

export const SERIAL_STATUSES = ['IN_STOCK', 'RESERVED', 'IN_TRANSIT', 'QUARANTINED', 'DAMAGED', 'ISSUED', 'DISPOSED'] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export interface SerialTrackingPolicyResponse {
  productId: string;
  captureMode: SerialCaptureMode;
  requireLotWhenBatchTracked: boolean;
  /** true when backed by a stored row; false when these are the implicit defaults (RECEIPT). */
  configured: boolean;
}

export interface SerialResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  serialNumber: string;
  lotId: string | null;
  lotNumber: string | null;
  status: SerialStatus;
  currentWarehouseId: string | null;
  warehouseCode: string | null;
  currentLocationId: string | null;
  lastMovementId: string | null;
  receivedAt: string | null;
  issuedAt: string | null;
}

/** One scope/bucket where the serial registry and the balance projection disagree. */
export interface SerialReconciliationRow {
  productId: string;
  productSku: string;
  warehouseId: string | null;
  lotId: string | null;
  bucket: string; // on_hand | in_transit | quarantined | damaged
  serialCount: string;
  balanceQty: string;
}
export interface SerialReconciliationResult {
  serialsChecked: number;
  drift: SerialReconciliationRow[];
  ok: boolean;
}
