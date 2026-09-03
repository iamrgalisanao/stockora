/**
 * Physical count contracts (Phase 15). Flow: COUNTING → REVIEW → APPROVED → POSTED.
 * On create, system (expected) quantities are snapshotted. Variances post as
 * ADJUSTMENT_IN/OUT to the ledger. Blind counts hide system qty/variance while COUNTING.
 */

export const COUNT_STATUSES = ['COUNTING', 'REVIEW', 'APPROVED', 'POSTED', 'CANCELLED'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const COUNT_TYPES = ['FULL', 'CYCLE', 'WAREHOUSE', 'CATEGORY', 'BIN', 'RANDOM'] as const;
export type CountType = (typeof COUNT_TYPES)[number];

export interface CountItemResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  lotId: string | null; // ADR 0007 — batch counts snapshot per lot
  systemQty?: string; // hidden while a blind count is still COUNTING
  countedQty: string | null;
  recountQty: string | null;
  varianceQty?: string; // hidden while a blind count is still COUNTING
  unitCost?: string; // gated by cost.view
  remarks: string | null;
}

export interface CountResponse {
  id: string;
  countNumber: string;
  warehouseId: string;
  warehouseCode: string;
  type: CountType;
  isBlind: boolean;
  status: CountStatus;
  snapshotAt: string;
  notes: string | null;
  requestorId: string | null;
  approvedById: string | null;
  postedAt: string | null;
  createdAt: string;
  varianceValue?: string; // gated by valuation.view
  items: CountItemResponse[];
}

export interface CountListItem {
  id: string;
  countNumber: string;
  warehouseCode: string;
  type: CountType;
  isBlind: boolean;
  status: CountStatus;
  createdAt: string;
  lineCount: number;
}
