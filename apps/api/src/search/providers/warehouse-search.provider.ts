import { Injectable } from '@nestjs/common';
import type { SearchResult } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { rankOf, type SearchContext } from '../search.types';

/**
 * Owns warehouse + location search. Warehouse-bound, so results are restricted to the user's
 * warehouse scope. ACTIVE only.
 */
@Injectable()
export class WarehouseSearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const contains = { contains: ctx.q, mode: 'insensitive' as const };
    const scope = ctx.warehouseScope;

    const [warehouses, locations] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'ACTIVE',
          ...(scope ? { id: { in: scope } } : {}),
          OR: [{ code: contains }, { name: contains }],
        },
        select: { id: true, code: true, name: true, status: true },
        take: ctx.limitPerProvider,
      }),
      this.prisma.warehouseLocation.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'ACTIVE',
          ...(scope ? { warehouseId: { in: scope } } : {}),
          OR: [{ code: contains }, { name: contains }],
        },
        select: { id: true, code: true, name: true, warehouseId: true, status: true },
        take: ctx.limitPerProvider,
      }),
    ]);

    const out: SearchResult[] = warehouses.map((w) => ({
      type: 'WAREHOUSE' as const,
      entityId: w.id,
      title: w.name,
      subtitle: `Warehouse ${w.code}`,
      code: w.code,
      status: w.status,
      warehouseId: w.id,
      route: `/warehouses/${w.id}`,
      rank: rankOf(ctx.qLower, { code: w.code, name: w.name }),
    }));
    for (const l of locations) {
      out.push({
        type: 'LOCATION',
        entityId: l.id,
        title: l.code,
        subtitle: l.name ? `Location · ${l.name}` : 'Location',
        code: l.code,
        status: l.status,
        warehouseId: l.warehouseId,
        route: `/warehouses/${l.warehouseId}`,
        rank: rankOf(ctx.qLower, { code: l.code, name: l.name }),
      });
    }
    return out;
  }
}
