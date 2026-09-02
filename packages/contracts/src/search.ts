/**
 * Global search contract (2A.2A). A search orchestrator fans out to per-domain providers and
 * normalizes every hit into this one shape. Search identifies and links — it never carries stock
 * availability (that stays a separate inventory query, per the resolver boundary).
 */

export const SEARCH_RESULT_TYPES = [
  'PRODUCT',
  'PRODUCT_VARIANT',
  'SUPPLIER',
  'WAREHOUSE',
  'LOCATION',
  'GOODS_RECEIPT',
  'RELEASE',
  'TRANSFER',
  'ADJUSTMENT',
  'PHYSICAL_COUNT',
] as const;
export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

export interface SearchResult {
  type: SearchResultType;
  entityId: string;
  title: string;
  subtitle: string | null;
  code: string | null;
  status: string | null;
  warehouseId: string | null;
  route: string; // web route that opens this entity
  /** Deterministic match quality: 0 exact code/barcode, 1 code prefix, 2 name, 3 reference. */
  rank: number;
}
