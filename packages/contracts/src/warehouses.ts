/** Warehouse + location contracts (Phase 06; lifecycle + generic location tree in 2A.1E). */

import type { EntityStatus } from './catalog';

export const WAREHOUSE_TYPES = [
  'MAIN',
  'BRANCH',
  'RETAIL_STORE',
  'STOCKROOM',
  'PRODUCTION',
  'TRANSIT',
  'RETURNS',
  'VIRTUAL',
] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

/** Operational eligibility of a location — classification metadata, not a balance bucket. */
export const LOCATION_USAGES = [
  'STORAGE',
  'RECEIVING',
  'STAGING',
  'QUARANTINE',
  'DAMAGED',
  'DISPATCH',
  'OTHER',
] as const;
export type LocationUsage = (typeof LOCATION_USAGES)[number];

/** Suggested (non-enforced) structural levels for the free-form `type` field. */
export const LOCATION_TYPE_SUGGESTIONS = [
  'ZONE',
  'AISLE',
  'RACK',
  'SHELF',
  'BIN',
  'STAGING',
  'RECEIVING',
  'DISPATCH',
  'QUARANTINE',
  'OTHER',
] as const;

export interface WarehouseResponse {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  address: string | null;
  managerId: string | null;
  managerName: string | null;
  phone: string | null;
  email: string | null;
  status: EntityStatus;
  isDefault: boolean;
  allowReceiving: boolean;
  allowDispatch: boolean;
  notes: string | null;
  createdAt: string;
}

export interface WarehouseLocationResponse {
  id: string;
  warehouseId: string;
  parentId: string | null;
  code: string;
  name: string | null;
  type: string | null;
  usage: LocationUsage;
  isPickable: boolean;
  status: EntityStatus;
}
