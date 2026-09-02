import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { ReorderRecommendation } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const OPEN_RECEIPT_STATUSES = ['DRAFT', 'RECEIVING', 'FOR_INSPECTION'] as const;

@Injectable()
export class ReorderService {
  constructor(private readonly prisma: PrismaService) {}

  async recommendations(organizationId: string, user: RequestUser): Promise<ReorderRecommendation[]> {
    const scope = user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;

    // Candidate products: tracked, with a reorder point set.
    const products = await this.prisma.product.findMany({
      where: { organizationId, trackInventory: true, reorderPoint: { gt: 0 } },
      select: {
        id: true,
        sku: true,
        name: true,
        reorderPoint: true,
        reorderQty: true,
        maxStock: true,
        leadTimeDays: true,
        cost: true,
        preferredSupplierId: true,
        baseUom: { select: { code: true } },
      },
    });
    if (products.length === 0) return [];

    const productIds = products.map((p) => p.id);

    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: { organizationId, productId: { in: productIds }, ...(scope ? { warehouseId: scope } : {}) },
      _sum: { onHand: true, reserved: true, quarantined: true },
    });
    const balByProduct = new Map(balances.map((b) => [b.productId, b._sum]));

    const incoming = await this.prisma.goodsReceiptItem.groupBy({
      by: ['productId'],
      where: {
        organizationId,
        productId: { in: productIds },
        receipt: { status: { in: [...OPEN_RECEIPT_STATUSES] }, ...(scope ? { warehouseId: scope } : {}) },
      },
      _sum: { expectedQty: true },
    });
    const incByProduct = new Map(incoming.map((i) => [i.productId, i._sum.expectedQty ?? D(0)]));

    // Preferred supplier names + per-supplier product cost.
    const supplierIds = [...new Set(products.map((p) => p.preferredSupplierId).filter((x): x is string => !!x))];
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({ where: { organizationId, id: { in: supplierIds } }, select: { id: true, companyName: true } })
      : [];
    const supplierName = new Map(suppliers.map((s) => [s.id, s.companyName]));
    const supplierProducts = supplierIds.length
      ? await this.prisma.supplierProduct.findMany({
          where: { organizationId, supplierId: { in: supplierIds }, productId: { in: productIds } },
          select: { supplierId: true, productId: true, cost: true },
        })
      : [];
    const spCost = new Map(supplierProducts.map((sp) => [`${sp.supplierId}|${sp.productId}`, sp.cost]));

    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const out: ReorderRecommendation[] = [];

    for (const p of products) {
      const sums = balByProduct.get(p.id);
      const onHand = D(sums?.onHand ?? 0);
      const reserved = D(sums?.reserved ?? 0);
      const quarantined = D(sums?.quarantined ?? 0);
      const available = onHand.sub(reserved).sub(quarantined);
      const reorderPoint = D(p.reorderPoint);
      if (available.gt(reorderPoint)) continue; // not below reorder point

      const reorderQty = D(p.reorderQty);
      const maxStock = D(p.maxStock);
      let suggested: Prisma.Decimal;
      if (reorderQty.gt(0)) suggested = reorderQty;
      else if (maxStock.gt(0)) suggested = Prisma.Decimal.max(maxStock.sub(available), reorderPoint);
      else suggested = reorderPoint.sub(available);
      if (suggested.lte(0)) suggested = reorderPoint.gt(0) ? reorderPoint : D(1);

      const unitCost = p.preferredSupplierId
        ? D(spCost.get(`${p.preferredSupplierId}|${p.id}`) ?? p.cost)
        : D(p.cost);

      const rec: ReorderRecommendation = {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        uomCode: p.baseUom.code,
        onHand: onHand.toString(),
        reserved: reserved.toString(),
        available: available.toString(),
        incoming: D(incByProduct.get(p.id) ?? 0).toString(),
        reorderPoint: reorderPoint.toString(),
        suggestedQty: suggested.toString(),
        preferredSupplierId: p.preferredSupplierId,
        preferredSupplierName: p.preferredSupplierId ? supplierName.get(p.preferredSupplierId) ?? null : null,
        leadTimeDays: p.leadTimeDays,
      };
      if (canCost) rec.estimatedCost = suggested.mul(unitCost).toDecimalPlaces(4).toString();
      out.push(rec);
    }

    // Most urgent first (lowest available relative to reorder point).
    out.sort((a, b) => Number(a.available) - Number(a.reorderPoint) - (Number(b.available) - Number(b.reorderPoint)));
    return out;
  }
}
