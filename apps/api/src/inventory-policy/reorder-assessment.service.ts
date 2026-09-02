import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { ReorderAssessment, ReorderState } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { D, NIL_UUID, ZERO } from '../inventory/inventory.constants';

/**
 * The single authoritative reorder calculation (ADR 0002 §2A.1C).
 *
 * Availability = onHand − reserved − quarantined. `inTransit` is SURFACED but never
 * counted into availability; it only downgrades REORDER_REQUIRED → INBOUND_COVERED.
 * Only ACTIVE policies on ACTIVE products/variants in ACTIVE warehouses are assessed.
 *
 * State precedence (first match wins):
 *   OUT_OF_STOCK     available ≤ 0
 *   REORDER_REQUIRED available ≤ reorderPoint and inbound does not cover the gap
 *   INBOUND_COVERED  available ≤ reorderPoint but available + inTransit > reorderPoint
 *   LOW_STOCK        available ≤ minStock (only reachable when minStock > reorderPoint)
 *   OVERSTOCK        maxStock set and onHand > maxStock
 *   OK               otherwise
 *
 * recommendedQuantity = reorderQuantity when (and only when) state is REORDER_REQUIRED.
 * The policy owns no purchasing logic — this returns an assessment, nothing more.
 */
@Injectable()
export class ReorderAssessmentService {
  constructor(private readonly prisma: PrismaService) {}

  async assess(organizationId: string, user: RequestUser): Promise<ReorderAssessment[]> {
    const scope = user.warehouseScope;
    const whIn = scope !== null ? { in: scope } : undefined;

    const policies = await this.prisma.inventoryPolicy.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        ...(whIn ? { warehouseId: whIn } : {}),
        product: { status: 'ACTIVE', trackInventory: true },
        warehouse: { status: 'ACTIVE' },
      },
      select: {
        warehouseId: true,
        productId: true,
        variantId: true,
        minStock: true,
        maxStock: true,
        reorderPoint: true,
        reorderQuantity: true,
        preferredSupplierId: true,
        warehouse: { select: { code: true } },
        product: { select: { sku: true, name: true, cost: true, baseUom: { select: { code: true } } } },
        preferredSupplier: { select: { companyName: true } },
      },
    });
    if (policies.length === 0) return [];

    // Drop policies whose (non-NIL) variant is not ACTIVE.
    const variantIds = [...new Set(policies.map((p) => p.variantId).filter((v) => v !== NIL_UUID))];
    const activeVariants = variantIds.length
      ? new Set(
          (
            await this.prisma.productVariant.findMany({
              where: { id: { in: variantIds }, status: 'ACTIVE' },
              select: { id: true },
            })
          ).map((v) => v.id),
        )
      : new Set<string>();
    const live = policies.filter((p) => p.variantId === NIL_UUID || activeVariants.has(p.variantId));
    if (live.length === 0) return [];

    // Balances for the exact (product, variant, warehouse) grain the policies govern.
    const productIds = [...new Set(live.map((p) => p.productId))];
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, productId: { in: productIds }, ...(whIn ? { warehouseId: whIn } : {}) },
      select: {
        productId: true,
        variantId: true,
        warehouseId: true,
        onHand: true,
        reserved: true,
        quarantined: true,
        inTransit: true,
      },
    });
    const balKey = (productId: string, variantId: string, warehouseId: string) =>
      `${productId}|${variantId}|${warehouseId}`;
    const balByKey = new Map(balances.map((b) => [balKey(b.productId, b.variantId, b.warehouseId), b]));

    // Preferred-supplier unit costs (fall back to product cost).
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const supplierPairs = live.filter((p) => p.preferredSupplierId);
    const spCost = new Map<string, Prisma.Decimal>();
    if (canCost && supplierPairs.length) {
      const rows = await this.prisma.supplierProduct.findMany({
        where: {
          organizationId,
          OR: supplierPairs.map((p) => ({ supplierId: p.preferredSupplierId!, productId: p.productId })),
        },
        select: { supplierId: true, productId: true, cost: true },
      });
      for (const r of rows) spCost.set(`${r.supplierId}|${r.productId}`, D(r.cost));
    }

    const out: ReorderAssessment[] = [];
    for (const p of live) {
      const b = balByKey.get(balKey(p.productId, p.variantId, p.warehouseId));
      const onHand = D(b?.onHand ?? 0);
      const reserved = D(b?.reserved ?? 0);
      const quarantined = D(b?.quarantined ?? 0);
      const inTransit = D(b?.inTransit ?? 0);
      const available = onHand.sub(reserved).sub(quarantined);

      const minStock = D(p.minStock);
      const reorderPoint = D(p.reorderPoint);
      const maxStock = p.maxStock === null ? null : D(p.maxStock);
      const reorderQuantity = D(p.reorderQuantity);

      const state = this.deriveState(available, onHand, inTransit, minStock, reorderPoint, maxStock);
      const recommended = state === 'REORDER_REQUIRED' ? reorderQuantity : ZERO;

      const assessment: ReorderAssessment = {
        warehouseId: p.warehouseId,
        warehouseCode: p.warehouse.code,
        productId: p.productId,
        productSku: p.product.sku,
        productName: p.product.name,
        variantId: p.variantId === NIL_UUID ? null : p.variantId,
        uomCode: p.product.baseUom.code,
        onHand: onHand.toString(),
        reserved: reserved.toString(),
        available: available.toString(),
        inTransit: inTransit.toString(),
        minStock: minStock.toString(),
        reorderPoint: reorderPoint.toString(),
        maxStock: maxStock === null ? null : maxStock.toString(),
        recommendedQuantity: recommended.toString(),
        state,
        preferredSupplierId: p.preferredSupplierId,
        preferredSupplierName: p.preferredSupplier?.companyName ?? null,
      };
      if (canCost && recommended.gt(0)) {
        const unit = spCost.get(`${p.preferredSupplierId}|${p.productId}`) ?? D(p.product.cost);
        assessment.estimatedCost = recommended.mul(unit).toDecimalPlaces(4).toString();
      }
      out.push(assessment);
    }
    return out;
  }

  /** Assessments needing action, most urgent (deepest below reorder point) first. */
  async recommendations(organizationId: string, user: RequestUser): Promise<ReorderAssessment[]> {
    const all = await this.assess(organizationId, user);
    return all
      .filter((a) => a.state === 'REORDER_REQUIRED')
      .sort((a, b) => Number(a.available) - Number(a.reorderPoint) - (Number(b.available) - Number(b.reorderPoint)));
  }

  /** Dashboard rollup — counts derived from the same authoritative assessment. */
  async counts(
    organizationId: string,
    user: RequestUser,
  ): Promise<{ lowStockCount: number; outOfStockCount: number; reorderCount: number }> {
    const all = await this.assess(organizationId, user);
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let reorderCount = 0;
    for (const a of all) {
      if (a.state === 'OUT_OF_STOCK') outOfStockCount += 1;
      else if (a.state === 'LOW_STOCK') lowStockCount += 1;
      if (a.state === 'REORDER_REQUIRED') reorderCount += 1;
    }
    return { lowStockCount, outOfStockCount, reorderCount };
  }

  private deriveState(
    available: Prisma.Decimal,
    onHand: Prisma.Decimal,
    inTransit: Prisma.Decimal,
    minStock: Prisma.Decimal,
    reorderPoint: Prisma.Decimal,
    maxStock: Prisma.Decimal | null,
  ): ReorderState {
    if (available.lte(0)) return 'OUT_OF_STOCK';
    if (available.lte(reorderPoint)) {
      return available.add(inTransit).gt(reorderPoint) ? 'INBOUND_COVERED' : 'REORDER_REQUIRED';
    }
    if (available.lte(minStock)) return 'LOW_STOCK';
    if (maxStock !== null && onHand.gt(maxStock)) return 'OVERSTOCK';
    return 'OK';
  }
}
