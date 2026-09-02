/**
 * Product Master read contracts (Phase 03). Decimal fields are serialized as strings
 * to preserve precision across the wire. `cost` fields are present only when the caller
 * holds the `cost.view` permission.
 */

export const ENTITY_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export interface UnitResponse {
  id: string;
  code: string;
  name: string;
  precision: number;
  status: EntityStatus;
}

export interface UnitConversionResponse {
  id: string;
  fromUomId: string;
  fromCode: string;
  toUomId: string;
  toCode: string;
  factor: string;
}

export interface BrandResponse {
  id: string;
  name: string;
  manufacturer: string | null;
  status: EntityStatus;
}

export interface CategoryResponse {
  id: string;
  parentId: string | null;
  name: string;
  status: EntityStatus;
}

export const BARCODE_TYPES = ['STANDARD', 'INTERNAL'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

export interface BarcodeResponse {
  id: string;
  code: string;
  barcodeType: BarcodeType;
  isPrimary: boolean;
  status: EntityStatus;
  variantId: string | null;
}

/** BarcodeResolver result — identity only, never inventory availability. */
export interface BarcodeResolutionResult {
  type: 'PRODUCT' | 'PRODUCT_VARIANT';
  entityId: string; // the variant id when PRODUCT_VARIANT, else the product id
  productId: string;
  variantId: string | null;
  displayCode: string;
  status: EntityStatus;
  metadata: { sku: string; name: string };
}

/** Why a scanned code did (not) resolve — an operator diagnostic, distinct from the plain contract. */
export const SCAN_OUTCOMES = ['RESOLVED', 'NOT_FOUND', 'INACTIVE', 'ARCHIVED', 'AMBIGUOUS'] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

export interface ScanDiagnosis {
  code: string;
  outcome: ScanOutcome;
  reason: string | null;
  /** Present only when outcome === 'RESOLVED'. Identity only — never availability. */
  result: BarcodeResolutionResult | null;
}

export interface VariantResponse {
  id: string;
  productId: string;
  sku: string;
  attributes: Record<string, unknown>;
  sellingPrice: string | null;
  cost?: string | null; // gated by cost.view
  status: EntityStatus;
}

export interface ProductResponse {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  productType: string | null;

  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;

  baseUomId: string;
  baseUomCode: string;
  purchaseUomId: string | null;
  salesUomId: string | null;

  sellingPrice: string;
  cost?: string; // gated by cost.view
  taxCategory: string | null;
  preferredSupplierId: string | null;

  // Reorder thresholds moved to InventoryPolicy (per warehouse).
  leadTimeDays: number;

  trackInventory: boolean;
  allowNegative: boolean;
  isSerialized: boolean;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  hasVariants: boolean;
  status: EntityStatus;

  imageUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  variants?: VariantResponse[];
  barcodes?: BarcodeResponse[];
}
