import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { DashboardSummary } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string, user: RequestUser): Promise<DashboardSummary> {
    const scope = user.warehouseScope;
    const whIn = scope !== null ? { in: scope } : undefined;

    const [products, balances, totalSkus] = await Promise.all([
      this.prisma.product.findMany({
        where: { organizationId, trackInventory: true },
        select: { id: true, reorderPoint: true },
      }),
      this.prisma.inventoryBalance.findMany({
        where: { organizationId, ...(whIn ? { warehouseId: whIn } : {}) },
        select: { productId: true, onHand: true, reserved: true, quarantined: true, inTransit: true, avgCost: true },
      }),
      this.prisma.product.count({ where: { organizationId } }),
    ]);

    let onHand = D(0);
    let reserved = D(0);
    let inTransit = D(0);
    let value = D(0);
    const availByProduct = new Map<string, Prisma.Decimal>();
    for (const b of balances) {
      onHand = onHand.add(b.onHand);
      reserved = reserved.add(b.reserved);
      inTransit = inTransit.add(b.inTransit);
      value = value.add(D(b.onHand).mul(b.avgCost));
      const avail = D(b.onHand).sub(b.reserved).sub(b.quarantined);
      availByProduct.set(b.productId, (availByProduct.get(b.productId) ?? D(0)).add(avail));
    }
    const totalAvailable = onHand.sub(reserved); // quarantined summed into per-product; org total approx

    let lowStockCount = 0;
    let outOfStockCount = 0;
    let reorderCount = 0;
    for (const p of products) {
      const avail = availByProduct.get(p.id) ?? D(0);
      const rp = D(p.reorderPoint);
      const belowReorder = rp.gt(0) && avail.lte(rp);
      if (avail.lte(0)) outOfStockCount += 1;
      else if (belowReorder) lowStockCount += 1;
      if (belowReorder) reorderCount += 1;
    }

    const [receipts, releases, transfers, adjustments, counts, recent] = await Promise.all([
      this.prisma.goodsReceipt.count({
        where: { organizationId, status: { in: ['DRAFT', 'RECEIVING', 'FOR_INSPECTION'] }, ...(whIn ? { warehouseId: whIn } : {}) },
      }),
      this.prisma.stockRelease.count({
        where: { organizationId, status: { in: ['DRAFT', 'FOR_APPROVAL', 'APPROVED'] }, ...(whIn ? { warehouseId: whIn } : {}) },
      }),
      this.prisma.stockTransfer.count({
        where: {
          organizationId,
          status: { in: ['DRAFT', 'FOR_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] },
          ...(whIn ? { OR: [{ sourceWarehouseId: whIn }, { destWarehouseId: whIn }] } : {}),
        },
      }),
      this.prisma.stockAdjustment.count({
        where: { organizationId, status: { in: ['DRAFT', 'SUBMITTED', 'PENDING_SECOND_APPROVAL', 'APPROVED'] }, ...(whIn ? { warehouseId: whIn } : {}) },
      }),
      this.prisma.stockCount.count({
        where: { organizationId, status: { in: ['COUNTING', 'REVIEW', 'APPROVED'] }, ...(whIn ? { warehouseId: whIn } : {}) },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { organizationId, ...(whIn ? { warehouseId: whIn } : {}) },
        include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
        orderBy: { postedAt: 'desc' },
        take: 5,
      }),
    ]);

    const summary: DashboardSummary = {
      totalSkus,
      totalOnHand: onHand.toString(),
      totalAvailable: totalAvailable.toString(),
      totalReserved: reserved.toString(),
      totalInTransit: inTransit.toString(),
      lowStockCount,
      outOfStockCount,
      reorderCount,
      pending: { receipts, releases, transfers, adjustments, counts },
      recentMovements: recent.map((m) => ({
        id: m.id,
        txnNumber: m.txnNumber,
        movementType: m.movementType,
        productSku: m.product.sku,
        warehouseCode: m.warehouse.code,
        quantity: m.quantity.toString(),
        postedAt: m.postedAt.toISOString(),
      })),
    };
    if (user.permissions.includes(PERMISSIONS.VALUATION_VIEW)) {
      summary.inventoryValue = value.toDecimalPlaces(4).toString();
    }
    return summary;
  }
}
