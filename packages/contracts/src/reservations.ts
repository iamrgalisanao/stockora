/**
 * Reservation contracts (2B.1). A reservation is a commitment against availability, not a physical
 * movement (ADR 0005): confirming adjusts the balance `reserved` bucket; on-hand changes only at
 * consumption. Decimal quantities are strings.
 */

export const RESERVATION_STATUSES = [
  'DRAFT',
  'RESERVED',
  'PARTIALLY_CONSUMED',
  'CONSUMED',
  'RELEASED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_SOURCES = ['MANUAL', 'INTERNAL_REQUEST', 'EXTERNAL'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

/** Centralized "expiring soon" window (hours) — one source of truth for API queries + UI. */
export const RESERVATION_EXPIRING_SOON_HOURS = 24;

/** The active reservation lines that make up a balance's `reserved` bucket (stock drill-down). */
export interface ReservedBreakdownRow {
  reservationId: string;
  reservationNo: string;
  lineId: string;
  status: ReservationStatus;
  remaining: string;
  expiresAt: string | null;
}

export interface ReservationLineResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  locationId: string | null;
  quantity: string;
  consumedQuantity: string;
  remaining: string; // quantity - consumedQuantity
}

export interface ReservationResponse {
  id: string;
  reservationNo: string;
  warehouseId: string;
  warehouseCode: string;
  sourceType: ReservationSource;
  sourceId: string | null;
  status: ReservationStatus;
  expiresAt: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  lines: ReservationLineResponse[];
}
