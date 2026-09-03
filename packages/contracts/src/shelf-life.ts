/**
 * Shelf-life + allocation policy contracts (2C.2, ADR 0008). Expiry is a lot attribute; FEFO is an
 * allocation policy. Near-expiry is a derived state, never a persisted lot status.
 */

export const ALLOCATION_STRATEGIES = ['MANUAL', 'FEFO'] as const;
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number];

/** Derived expiry state for a lot (not persisted; lot lifecycle stays ACTIVE/CLOSED/ARCHIVED). */
export const LOT_EXPIRY_STATES = ['EXPIRED', 'EXPIRING_SOON', 'HEALTHY', 'NO_EXPIRY'] as const;
export type LotExpiryState = (typeof LOT_EXPIRY_STATES)[number];

/** Org/global default window for "expiring soon" when a policy sets no override. */
export const DEFAULT_EXPIRING_SOON_DAYS = 30;

/** One line of an allocation plan (which lot, how much). */
export interface AllocationPlanLine {
  lotId: string;
  lotNumber: string;
  expiryDate: string | null;
  quantity: string;
}

/** A read-only allocation plan produced by a strategy (FEFO or a manual echo). Advisory until posted. */
export interface AllocationPlan {
  requestedQuantity: string;
  allocatedQuantity: string;
  complete: boolean; // allocatedQuantity == requestedQuantity from eligible stock
  strategy: AllocationStrategy;
  generatedAt: string;
  allocations: AllocationPlanLine[];
}

export interface ShelfLifePolicyResponse {
  productId: string;
  variantId: string | null;
  expiryTrackingRequired: boolean;
  minimumShelfLifeOnReceiptDays: number | null;
  expiringSoonDays: number | null;
  allocationStrategy: AllocationStrategy;
  /** true when backed by a stored row; false when these are the implicit defaults (no policy set). */
  configured: boolean;
}
