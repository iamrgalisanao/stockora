import { Injectable } from '@nestjs/common';
import type { SearchResult } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { rankOf, type SearchContext } from '../search.types';

/**
 * Owns operational-document search (receipts, releases, transfers, adjustments, counts) by document
 * number and reference fields. Warehouse-scoped. ALL statuses are searchable — completed/cancelled
 * historical documents must remain findable.
 */
@Injectable()
export class DocumentSearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const c = { contains: ctx.q, mode: 'insensitive' as const };
    const org = ctx.organizationId;
    const scope = ctx.warehouseScope;
    const whIn = scope ? { in: scope } : undefined;
    const take = ctx.limitPerProvider;

    const [receipts, releases, transfers, adjustments, counts] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where: {
          organizationId: org,
          ...(whIn ? { warehouseId: whIn } : {}),
          OR: [{ receiptNumber: c }, { purchaseOrderRef: c }, { deliveryReceiptRef: c }, { supplierInvoiceRef: c }],
        },
        select: { id: true, receiptNumber: true, status: true, warehouseId: true, purchaseOrderRef: true },
        take,
      }),
      this.prisma.stockRelease.findMany({
        where: {
          organizationId: org,
          ...(whIn ? { warehouseId: whIn } : {}),
          OR: [{ releaseNumber: c }, { reference: c }, { destinationRef: c }],
        },
        select: { id: true, releaseNumber: true, status: true, warehouseId: true, reference: true },
        take,
      }),
      this.prisma.stockTransfer.findMany({
        where: {
          organizationId: org,
          ...(scope ? { OR: [{ sourceWarehouseId: whIn }, { destWarehouseId: whIn }] } : {}),
          AND: [{ OR: [{ transferNumber: c }, { reference: c }] }],
        },
        select: { id: true, transferNumber: true, status: true, sourceWarehouseId: true, reference: true },
        take,
      }),
      this.prisma.stockAdjustment.findMany({
        where: {
          organizationId: org,
          ...(whIn ? { warehouseId: whIn } : {}),
          adjustmentNumber: c,
        },
        select: { id: true, adjustmentNumber: true, status: true, warehouseId: true },
        take,
      }),
      this.prisma.stockCount.findMany({
        where: {
          organizationId: org,
          ...(whIn ? { warehouseId: whIn } : {}),
          countNumber: c,
        },
        select: { id: true, countNumber: true, status: true, warehouseId: true },
        take,
      }),
    ]);

    const out: SearchResult[] = [];
    for (const r of receipts) {
      out.push({
        type: 'GOODS_RECEIPT', entityId: r.id, title: r.receiptNumber, subtitle: `Receipt · ${r.status}`,
        code: r.receiptNumber, status: r.status, warehouseId: r.warehouseId, route: '/receiving',
        rank: rankOf(ctx.qLower, { code: r.receiptNumber, reference: r.purchaseOrderRef }),
      });
    }
    for (const r of releases) {
      out.push({
        type: 'RELEASE', entityId: r.id, title: r.releaseNumber, subtitle: `Release · ${r.status}`,
        code: r.releaseNumber, status: r.status, warehouseId: r.warehouseId, route: `/releases/${r.id}`,
        rank: rankOf(ctx.qLower, { code: r.releaseNumber, reference: r.reference }),
      });
    }
    for (const t of transfers) {
      out.push({
        type: 'TRANSFER', entityId: t.id, title: t.transferNumber, subtitle: `Transfer · ${t.status}`,
        code: t.transferNumber, status: t.status, warehouseId: t.sourceWarehouseId, route: `/transfers/${t.id}`,
        rank: rankOf(ctx.qLower, { code: t.transferNumber, reference: t.reference }),
      });
    }
    for (const a of adjustments) {
      out.push({
        type: 'ADJUSTMENT', entityId: a.id, title: a.adjustmentNumber, subtitle: `Adjustment · ${a.status}`,
        code: a.adjustmentNumber, status: a.status, warehouseId: a.warehouseId, route: `/adjustments/${a.id}`,
        rank: rankOf(ctx.qLower, { code: a.adjustmentNumber }),
      });
    }
    for (const co of counts) {
      out.push({
        type: 'PHYSICAL_COUNT', entityId: co.id, title: co.countNumber, subtitle: `Count · ${co.status}`,
        code: co.countNumber, status: co.status, warehouseId: co.warehouseId, route: `/counts/${co.id}`,
        rank: rankOf(ctx.qLower, { code: co.countNumber }),
      });
    }
    return out;
  }
}
