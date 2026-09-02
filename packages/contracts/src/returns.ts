/**
 * Returns + disposition contracts (2B.2). A return receives physical stock into QUARANTINE (ADR 0006):
 * intake and disposition are separate immutable ledger events. Quarantined stock is on-hand but held,
 * so it is not sellable until inspected. Decimal quantities are strings.
 */

export const RETURN_TYPES = ['CUSTOMER', 'SUPPLIER', 'INTERNAL'] as const;
export type ReturnType = (typeof RETURN_TYPES)[number];

export const RETURN_STATUSES = [
  'DRAFT',
  'RECEIVED',
  'PARTIALLY_DISPOSED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Inspection outcomes (2B.2B). RESTOCK is gated by return.inspect; the rest by return.dispose. */
export const DISPOSITION_TYPES = ['RESTOCK', 'DAMAGED', 'RETURN_TO_SUPPLIER', 'DISPOSE'] as const;
export type DispositionType = (typeof DISPOSITION_TYPES)[number];

export interface ReturnDispositionResponse {
  id: string;
  type: DispositionType;
  quantity: string;
  reason: string | null;
  notes: string | null;
  performedById: string | null;
  performedAt: string;
}

export interface ReturnLineResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  locationId: string | null;
  quantity: string; // declared at DRAFT
  receivedQuantity: string; // taken into quarantine at RECEIVE
  disposedQuantity: string; // total drawn out of quarantine by dispositions
  remainingQuarantine: string; // receivedQuantity - disposedQuantity
  dispositions: ReturnDispositionResponse[];
}

export interface ReturnResponse {
  id: string;
  returnNo: string;
  type: ReturnType;
  warehouseId: string;
  warehouseCode: string;
  sourceReference: string | null;
  status: ReturnStatus;
  reason: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  receivedAt: string | null;
  completedAt: string | null;
  lines: ReturnLineResponse[];
}
