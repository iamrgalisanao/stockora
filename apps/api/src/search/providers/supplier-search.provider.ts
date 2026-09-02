import { Injectable } from '@nestjs/common';
import type { SearchResult } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { rankOf, type SearchContext } from '../search.types';

/** Owns supplier search (code / company name). ACTIVE suppliers only. */
@Injectable()
export class SupplierSearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const contains = { contains: ctx.q, mode: 'insensitive' as const };
    const rows = await this.prisma.supplier.findMany({
      where: {
        organizationId: ctx.organizationId,
        status: 'ACTIVE',
        OR: [{ code: contains }, { companyName: contains }],
      },
      select: { id: true, code: true, companyName: true, status: true },
      take: ctx.limitPerProvider,
    });
    return rows.map((s) => ({
      type: 'SUPPLIER' as const,
      entityId: s.id,
      title: s.companyName,
      subtitle: `Supplier ${s.code}`,
      code: s.code,
      status: s.status,
      warehouseId: null,
      route: `/suppliers/${s.id}`,
      rank: rankOf(ctx.qLower, { code: s.code, name: s.companyName }),
    }));
  }
}
