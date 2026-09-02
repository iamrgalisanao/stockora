import { Injectable } from '@nestjs/common';
import { Prisma, MovementType, InventoryMovement } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type {
  BalanceResponse,
  MovementResponse,
  ReconciliationResult,
  StockCardEntry,
  StockCardResponse,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { D, NIL_UUID, ZERO } from './inventory.constants';

@Injectable()
export class InventoryQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeFilter(user: RequestUser): { in: string[] } | undefined {
    return user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;
  }

  async listBalances(
    organizationId: string,
    user: RequestUser,
    filter: { warehouseId?: string; productId?: string },
  ): Promise<BalanceResponse[]> {
    const scope = this.scopeFilter(user);
    const rows = await this.prisma.inventoryBalance.findMany({
      where: {
        organizationId,
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(scope ? { warehouseId: scope } : {}),
      },
      include: { product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } } },
      orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }],
    });

    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const canVal = user.permissions.includes(PERMISSIONS.VALUATION_VIEW);

    return rows.map((b) => {
      const onHand = D(b.onHand);
      const available = onHand.sub(D(b.reserved)).sub(D(b.quarantined));
      const res: BalanceResponse = {
        productId: b.productId,
        productSku: b.product.sku,
        productName: b.product.name,
        variantId: b.variantId === NIL_UUID ? null : b.variantId,
        lotId: b.lotId === NIL_UUID ? null : b.lotId,
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        onHand: onHand.toString(),
        reserved: b.reserved.toString(),
        inTransit: b.inTransit.toString(),
        quarantined: b.quarantined.toString(),
        damaged: b.damaged.toString(),
        available: available.toString(),
      };
      if (canCost) res.avgCost = b.avgCost.toString();
      if (canVal) res.value = onHand.mul(D(b.avgCost)).toDecimalPlaces(4).toString();
      return res;
    });
  }

  async listMovements(
    organizationId: string,
    user: RequestUser,
    filter: { productId?: string; warehouseId?: string; type?: MovementType; lotId?: string; limit?: number },
  ): Promise<MovementResponse[]> {
    const scope = this.scopeFilter(user);
    const rows = await this.prisma.inventoryMovement.findMany({
      where: {
        organizationId,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.type ? { movementType: filter.type } : {}),
        ...(filter.lotId ? { lotId: filter.lotId } : {}),
        ...(scope ? { warehouseId: scope } : {}),
      },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: { postedAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    return rows.map((m) => this.mapMovement(m, canCost));
  }

  async stockCard(
    organizationId: string,
    user: RequestUser,
    productId: string,
    filter: { warehouseId?: string },
  ): Promise<StockCardResponse> {
    const scope = this.scopeFilter(user);
    const rows = await this.prisma.inventoryMovement.findMany({
      where: {
        organizationId,
        productId,
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope ? { warehouseId: scope } : {}),
      },
      include: { product: { select: { sku: true } } },
      orderBy: [{ postedAt: 'asc' }, { txnNumber: 'asc' }],
    });

    let running = ZERO;
    const entries: StockCardEntry[] = rows.map((m) => {
      const delta = D(m.onHandDelta);
      running = running.add(delta);
      return {
        postedAt: m.postedAt.toISOString(),
        txnNumber: m.txnNumber,
        movementType: m.movementType,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        in: delta.gt(0) ? delta.toString() : '0',
        out: delta.lt(0) ? delta.abs().toString() : '0',
        balance: running.toString(),
      };
    });

    return {
      productId,
      productSku: rows[0]?.product.sku ?? '',
      warehouseId: filter.warehouseId ?? null,
      entries,
      closingBalance: running.toString(),
    };
  }

  /**
   * Recomputes balances from the ledger (sum of deltas) and compares against the
   * materialized projection. The ledger is authoritative; any drift is a bug.
   */
  async reconcile(organizationId: string): Promise<ReconciliationResult> {
    const grouped = await this.prisma.inventoryMovement.groupBy({
      by: ['productId', 'variantId', 'warehouseId'],
      where: { organizationId },
      _sum: {
        onHandDelta: true,
        reservedDelta: true,
        inTransitDelta: true,
        quarantinedDelta: true,
        damagedDelta: true,
      },
    });

    type BucketSums = {
      onHand: Prisma.Decimal;
      reserved: Prisma.Decimal;
      inTransit: Prisma.Decimal;
      quarantined: Prisma.Decimal;
      damaged: Prisma.Decimal;
    };
    const ledger = new Map<string, BucketSums>();
    for (const g of grouped) {
      const key = `${g.productId}|${g.variantId ?? NIL_UUID}|${g.warehouseId}`;
      ledger.set(key, {
        onHand: D(g._sum.onHandDelta ?? 0),
        reserved: D(g._sum.reservedDelta ?? 0),
        inTransit: D(g._sum.inTransitDelta ?? 0),
        quarantined: D(g._sum.quarantinedDelta ?? 0),
        damaged: D(g._sum.damagedDelta ?? 0),
      });
    }

    const balances = await this.prisma.inventoryBalance.findMany({ where: { organizationId } });
    const drift: ReconciliationResult['drift'] = [];

    for (const b of balances) {
      const key = `${b.productId}|${b.variantId}|${b.warehouseId}`;
      const l = ledger.get(key) ?? {
        onHand: ZERO,
        reserved: ZERO,
        inTransit: ZERO,
        quarantined: ZERO,
        damaged: ZERO,
      };
      const compare: Array<[string, Prisma.Decimal, Prisma.Decimal]> = [
        ['on_hand', D(b.onHand), l.onHand],
        ['reserved', D(b.reserved), l.reserved],
        ['in_transit', D(b.inTransit), l.inTransit],
        ['quarantined', D(b.quarantined), l.quarantined],
        ['damaged', D(b.damaged), l.damaged],
      ];
      for (const [bucket, projected, ledgerVal] of compare) {
        if (!projected.equals(ledgerVal)) {
          drift.push({
            productId: b.productId,
            variantId: b.variantId === NIL_UUID ? null : b.variantId,
            warehouseId: b.warehouseId,
            bucket,
            projected: projected.toString(),
            ledger: ledgerVal.toString(),
          });
        }
      }
    }

    return { balancesChecked: balances.length, drift, ok: drift.length === 0 };
  }

  /** Maps a set of just-posted movements (by id) to responses. */
  async getMovements(
    organizationId: string,
    user: RequestUser,
    ids: string[],
  ): Promise<MovementResponse[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.inventoryMovement.findMany({
      where: { organizationId, id: { in: ids } },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: { postedAt: 'asc' },
    });
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    return rows.map((m) => this.mapMovement(m, canCost));
  }

  mapMovement(
    m: InventoryMovement & { product: { sku: string }; warehouse: { code: string } },
    canViewCost: boolean,
  ): MovementResponse {
    const res: MovementResponse = {
      id: m.id,
      txnNumber: m.txnNumber,
      movementType: m.movementType,
      isReversal: m.reversalOfId !== null,
      productId: m.productId,
      productSku: m.product.sku,
      variantId: m.variantId,
      lotId: m.lotId,
      warehouseId: m.warehouseId,
      warehouseCode: m.warehouse.code,
      quantity: m.quantity.toString(),
      onHandDelta: m.onHandDelta.toString(),
      reservedDelta: m.reservedDelta.toString(),
      inTransitDelta: m.inTransitDelta.toString(),
      quarantinedDelta: m.quarantinedDelta.toString(),
      damagedDelta: m.damagedDelta.toString(),
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      reason: m.reason,
      performedById: m.performedById,
      postedAt: m.postedAt.toISOString(),
    };
    if (canViewCost) {
      res.unitCost = m.unitCost.toString();
      res.totalCost = m.totalCost.toString();
    }
    return res;
  }
}
