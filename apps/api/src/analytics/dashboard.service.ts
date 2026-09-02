import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { DashboardSummary } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { ReorderAssessmentService } from '../inventory-policy/reorder-assessment.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reorder: ReorderAssessmentService,
  ) {}

  async summary(organizationId: string, user: RequestUser): Promise<DashboardSummary> {
    const scope = user.warehouseScope;
    const whIn = scope !== null ? { in: scope } : undefined;

    const [balances, totalSkus, stockCounts] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { organizationId, ...(whIn ? { warehouseId: whIn } : {}) },
        select: { productId: true, onHand: true, reserved: true, quarantined: true, inTransit: true, avgCost: true },
      }),
      this.prisma.product.count({ where: { organizationId } }),
      // Low/out/reorder derive from the authoritative policy-driven assessment.
      this.reorder.counts(organizationId, user),
    ]);

    let onHand = D(0);
    let reserved = D(0);
    let inTransit = D(0);
    let value = D(0);
    for (const b of balances) {
      onHand = onHand.add(b.onHand);
      reserved = reserved.add(b.reserved);
      inTransit = inTransit.add(b.inTransit);
      value = value.add(D(b.onHand).mul(b.avgCost));
    }
    const totalAvailable = onHand.sub(reserved); // quarantined summed into per-product; org total approx

    const { lowStockCount, outOfStockCount, reorderCount } = stockCounts;

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
