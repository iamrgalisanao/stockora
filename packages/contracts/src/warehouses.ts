/** Warehouse + location contracts (Phase 06). */

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
  status: 'ACTIVE' | 'INACTIVE';
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
  isPickable: boolean;
  isReceivingArea: boolean;
  isActive: boolean;
}
