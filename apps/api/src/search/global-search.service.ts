import { Injectable } from '@nestjs/common';
import type { SearchResult } from '@iw/contracts';
import type { RequestUser } from '../common/request-user';
import { CatalogSearchProvider } from './providers/catalog-search.provider';
import { SupplierSearchProvider } from './providers/supplier-search.provider';
import { WarehouseSearchProvider } from './providers/warehouse-search.provider';
import { DocumentSearchProvider } from './providers/document-search.provider';
import type { SearchContext } from './search.types';

const LIMIT_PER_PROVIDER = 8;

/**
 * Fans a query out to per-domain providers (each owning its own searchable fields + scope rules) and
 * normalizes the hits into one ranked list. No giant cross-domain SQL — domain ownership stays clean.
 */
@Injectable()
export class GlobalSearchService {
  constructor(
    private readonly catalog: CatalogSearchProvider,
    private readonly suppliers: SupplierSearchProvider,
    private readonly warehouses: WarehouseSearchProvider,
    private readonly documents: DocumentSearchProvider,
  ) {}

  async search(user: RequestUser, rawQuery: string, limit = 30): Promise<SearchResult[]> {
    const q = (rawQuery ?? '').trim();
    if (q.length === 0) return [];

    const ctx: SearchContext = {
      organizationId: user.organizationId,
      warehouseScope: user.warehouseScope,
      q,
      qLower: q.toLowerCase(),
      limitPerProvider: LIMIT_PER_PROVIDER,
    };

    const groups = await Promise.all([
      this.catalog.search(ctx),
      this.suppliers.search(ctx),
      this.warehouses.search(ctx),
      this.documents.search(ctx),
    ]);

    // Dedupe by (type, entityId), keeping the best (lowest) rank.
    const best = new Map<string, SearchResult>();
    for (const r of groups.flat()) {
      const key = `${r.type}:${r.entityId}`;
      const existing = best.get(key);
      if (!existing || r.rank < existing.rank) best.set(key, r);
    }

    return [...best.values()]
      .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }
}
