import { Injectable } from '@nestjs/common';
import type { SearchResult } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { rankOf, type SearchContext } from '../search.types';

/**
 * Owns product, variant, and barcode identity search. An exact barcode/SKU match ranks ahead of a
 * mere name hit. Only ACTIVE products/variants surface (inactive/archived are excluded from search).
 */
@Injectable()
export class CatalogSearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const contains = { contains: ctx.q, mode: 'insensitive' as const };
    const [barcodes, products, variants] = await Promise.all([
      this.prisma.productBarcode.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'ACTIVE',
          code: contains,
          product: { status: 'ACTIVE' },
        },
        select: {
          code: true,
          productId: true,
          variantId: true,
          product: { select: { name: true } },
          variant: { select: { sku: true, status: true } },
        },
        take: ctx.limitPerProvider,
      }),
      this.prisma.product.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'ACTIVE',
          OR: [{ sku: contains }, { name: contains }, { description: contains }],
        },
        select: { id: true, sku: true, name: true, description: true, status: true },
        take: ctx.limitPerProvider,
      }),
      this.prisma.productVariant.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: 'ACTIVE',
          sku: contains,
          product: { status: 'ACTIVE' },
        },
        select: { id: true, sku: true, productId: true, product: { select: { name: true } } },
        take: ctx.limitPerProvider,
      }),
    ]);

    const out: SearchResult[] = [];

    for (const b of barcodes) {
      // Exclude a barcode pinned to a non-active variant.
      if (b.variantId && b.variant && b.variant.status !== 'ACTIVE') continue;
      out.push({
        type: b.variantId ? 'PRODUCT_VARIANT' : 'PRODUCT',
        entityId: b.variantId ?? b.productId,
        title: b.product.name,
        subtitle: b.variantId ? `Variant ${b.variant?.sku ?? ''}` : 'Product',
        code: b.code,
        status: 'ACTIVE',
        warehouseId: null,
        route: `/products/${b.productId}`,
        rank: b.code.toLowerCase() === ctx.qLower ? 0 : 1,
      });
    }
    for (const p of products) {
      out.push({
        type: 'PRODUCT',
        entityId: p.id,
        title: p.name,
        subtitle: `SKU ${p.sku}`,
        code: p.sku,
        status: p.status,
        warehouseId: null,
        route: `/products/${p.id}`,
        rank: rankOf(ctx.qLower, { code: p.sku, name: p.name, reference: p.description }),
      });
    }
    for (const v of variants) {
      out.push({
        type: 'PRODUCT_VARIANT',
        entityId: v.id,
        title: v.product.name,
        subtitle: `Variant ${v.sku}`,
        code: v.sku,
        status: 'ACTIVE',
        warehouseId: null,
        route: `/products/${v.productId}`,
        rank: rankOf(ctx.qLower, { code: v.sku, name: v.product.name }),
      });
    }
    return out;
  }
}
