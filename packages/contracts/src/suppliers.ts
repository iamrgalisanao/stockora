/**
 * Supplier contracts (Phase 05; lifecycle in 2A.1D). `cost` on supplier-product
 * offers is gated by `cost.view`. `status` is the master-data lifecycle (ADR 0003).
 */

import type { EntityStatus } from './catalog';

export interface SupplierResponse {
  id: string;
  code: string;
  companyName: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  paymentTerms: string | null;
  leadTimeDays: number;
  rating: number | null;
  isPreferred: boolean;
  status: EntityStatus;
  notes: string | null;
  createdAt: string;
}

export interface SupplierProductResponse {
  id: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productSku: string;
  productName: string;
  supplierSku: string | null;
  cost?: string; // gated by cost.view
  leadTimeDays: number | null;
  minOrderQty: string | null;
  isPreferred: boolean;
  status: EntityStatus;
}
