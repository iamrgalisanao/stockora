/** Stock release contracts (Phase 11). Enforced flow: DRAFT → FOR_APPROVAL → APPROVED → RELEASED. */

export const RELEASE_STATUSES = [
  'DRAFT',
  'FOR_APPROVAL',
  'APPROVED',
  'RELEASED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_DESTINATION_TYPES = [
  'CUSTOMER',
  'DEPARTMENT',
  'EMPLOYEE',
  'PROJECT',
  'JOB_SITE',
  'PRODUCTION',
  'BRANCH',
  'INTERNAL_CONSUMPTION',
] as const;
export type ReleaseDestinationType = (typeof RELEASE_DESTINATION_TYPES)[number];

export interface ReleaseItemResponse {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  requestedQty: string;
  approvedQty: string;
  releasedQty: string;
  locationId: string | null;
  reservationLineId: string | null;
  remarks: string | null;
  serialNumbers: string[];
}

export interface ReleaseResponse {
  id: string;
  releaseNumber: string;
  warehouseId: string;
  warehouseCode: string;
  purpose: string | null;
  destinationType: ReleaseDestinationType;
  destinationRef: string | null;
  reference: string | null;
  status: ReleaseStatus;
  requestorId: string | null;
  approvedById: string | null;
  notes: string | null;
  postedAt: string | null;
  createdAt: string;
  items: ReleaseItemResponse[];
}

export interface ReleaseListItem {
  id: string;
  releaseNumber: string;
  warehouseCode: string;
  destinationType: ReleaseDestinationType;
  purpose: string | null;
  status: ReleaseStatus;
  createdAt: string;
  lineCount: number;
}
