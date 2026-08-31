/**
 * Product Master read contracts (Phase 03). Decimal fields are serialized as strings
 * to preserve precision across the wire. `cost` fields are present only when the caller
 * holds the `cost.view` permission.
 */

export interface UnitResponse {
  id: string;
  code: string;
  name: string;
  precision: number;
  isActive: boolean;
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
  isActive: boolean;
}

export interface CategoryResponse {
  id: string;
  parentId: string | null;
  name: string;
  isActive: boolean;
}

export interface VariantResponse {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, unknown>;
  sellingPrice: string | null;
  cost?: string | null; // gated by cost.view
  isActive: boolean;
}

export interface ProductResponse {
  id: string;
  sku: string;
  barcode: string | null;
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

  minStock: string;
  maxStock: string;
  reorderPoint: string;
  reorderQty: string;
  leadTimeDays: number;

  trackInventory: boolean;
  allowNegative: boolean;
  isSerialized: boolean;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  hasVariants: boolean;
  isActive: boolean;

  imageUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;

  variants?: VariantResponse[];
}
