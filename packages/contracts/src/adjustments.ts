/**
 * Stock adjustment contracts (Phase 14). Flow: DRAFT → SUBMITTED → APPROVED → POSTED,
 * with an extra PENDING_SECOND_APPROVAL step when the value exceeds the org's high-value
 * threshold (organization.settings.highValueAdjustmentThreshold). Reasons are configurable.
 */

export const ADJUSTMENT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PENDING_SECOND_APPROVAL',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'CANCELLED',
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export type AdjustmentDirection = 'IN' | 'OUT';

/** Default adjustment reasons seeded for a new organization (fully editable afterwards). */
export const DEFAULT_ADJUSTMENT_REASONS: Array<{ code: string; name: string }> = [
  { code: 'PHYSICAL_COUNT', name: 'Physical Count Variance' },
  { code: 'DAMAGED', name: 'Damaged' },
  { code: 'EXPIRED', name: 'Expired' },
  { code: 'LOST', name: 'Lost' },
  { code: 'FOUND', name: 'Found' },
  { code: 'DATA_CORRECTION', name: 'Data Correction' },
  { code: 'SHRINKAGE', name: 'Shrinkage' },
  { code: 'QUALITY_FAILURE', name: 'Quality Failure' },
  { code: 'BREAKAGE', name: 'Breakage' },
  { code: 'OTHER', name: 'Other' },
];

export interface AdjustmentReasonResponse {
  id: string;
  code: string;
  name: string;
  requiresEvidence: boolean;
  isActive: boolean;
}

export interface AdjustmentItemResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  direction: AdjustmentDirection;
  quantity: string;
  unitCost?: string; // gated by cost.view
  remarks: string | null;
}

export interface AdjustmentResponse {
  id: string;
  adjustmentNumber: string;
  warehouseId: string;
  warehouseCode: string;
  reasonId: string | null;
  reasonName: string | null;
  status: AdjustmentStatus;
  requiresSecondApproval: boolean;
  estimatedValue?: string; // gated by valuation.view
  requestorId: string | null;
  firstApprovedById: string | null;
  secondApprovedById: string | null;
  notes: string | null;
  postedAt: string | null;
  createdAt: string;
  items: AdjustmentItemResponse[];
}

export interface AdjustmentListItem {
  id: string;
  adjustmentNumber: string;
  warehouseCode: string;
  reasonName: string | null;
  status: AdjustmentStatus;
  requiresSecondApproval: boolean;
  createdAt: string;
  lineCount: number;
}
