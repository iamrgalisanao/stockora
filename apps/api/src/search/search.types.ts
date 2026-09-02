/** Shared context every search provider receives. */
export interface SearchContext {
  organizationId: string;
  /** null = all warehouses; otherwise the ids this user may see (for warehouse-bound entities). */
  warehouseScope: string[] | null;
  q: string;
  qLower: string;
  /** Max results a single provider should return. */
  limitPerProvider: number;
}

/**
 * Deterministic v1 ranking (lower = better):
 *   0  exact code/barcode match
 *   1  code prefix match
 *   2  name/title contains (or code mid-string)
 *   3  reference/description contains
 */
export function rankOf(
  qLower: string,
  fields: { code?: string | null; name?: string | null; reference?: string | null },
): number {
  const code = (fields.code ?? '').toLowerCase();
  const name = (fields.name ?? '').toLowerCase();
  const reference = (fields.reference ?? '').toLowerCase();
  if (code && code === qLower) return 0;
  if (code && code.startsWith(qLower)) return 1;
  if (name.includes(qLower)) return 2;
  if (code.includes(qLower)) return 2;
  if (reference.includes(qLower)) return 3;
  return 3;
}
