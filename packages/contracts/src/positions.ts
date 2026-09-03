/**
 * Inventory-position read model (2C.4). A pure projection over the ledger-backed balance buckets — no new
 * stored fields. `available = onHand - reserved - quarantined` (damaged sits OUTSIDE onHand and is never
 * subtracted again; in-transit is inbound context, never promiseable). One row per finest grain
 * (product, variant, warehouse, lot); the UI rolls up product → warehouse → lot.
 */

import type { LotExpiryState } from './shelf-life';

export interface InventoryPositionRow {
  productId: string;
  productSku: string;
  productName: string;
  isBatchTracked: boolean;
  variantId: string | null;
  warehouseId: string;
  warehouseCode: string;
  lotId: string | null; // null for non-batch stock — no fake lot dimension
  lotNumber: string | null;
  expiryDate: string | null;
  expiryState: LotExpiryState; // NO_EXPIRY for non-batch / no-expiry lots
  onHand: string;
  reserved: string;
  quarantined: string;
  damaged: string;
  inTransit: string;
  available: string; // onHand - reserved - quarantined
  avgCost?: string; // gated by cost.view
  value?: string; // onHand * avgCost, gated by valuation.view
}

/** Availability-lens filters — "what state is this stock in / can I promise it?" */
export const POSITION_FILTERS = [
  'AVAILABLE', // available > 0
  'UNAVAILABLE', // available <= 0
  'FULLY_RESERVED', // physical on hand, but reservations consume all of it
  'QUARANTINED', // quarantined > 0
  'IN_TRANSIT_ONLY', // inbound only, nothing landed yet
  'NEGATIVE_ANOMALY', // any bucket (or available) negative — data/operational anomaly
  'EXPIRED_LOT', // physically present but an expired lot (not outbound-eligible)
] as const;
export type PositionFilter = (typeof POSITION_FILTERS)[number];
