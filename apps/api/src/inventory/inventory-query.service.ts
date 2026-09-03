import { Injectable } from '@nestjs/common';
import { Prisma, MovementType, InventoryMovement } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type {
  BalanceResponse,
  InventoryPositionRow,
  MovementResponse,
  PositionFilter,
  ReconciliationResult,
  StockCardEntry,
  StockCardResponse,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { expiryStateOf } from '../common/business-date';
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

  /**
   * Unified inventory-position read model (2C.4). One row per finest grain over the balance projection,
   * with derived availability + lot expiry context. Feeds both the position roll-up and the availability
   * lens; the availability `filter` is applied here so both views share one source of truth.
   */
  async listPositions(
    organizationId: string,
    user: RequestUser,
    filter: { warehouseId?: string; productId?: string; q?: string; filter?: PositionFilter; hasStock?: boolean },
  ): Promise<InventoryPositionRow[]> {
    const scope = this.scopeFilter(user);
    const rows = await this.prisma.inventoryBalance.findMany({
      where: {
        organizationId,
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(scope ? { warehouseId: scope } : {}),
      },
      include: {
        product: { select: { sku: true, name: true, isBatchTracked: true } },
        warehouse: { select: { code: true } },
      },
      orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }],
    });

    const lotIds = [...new Set(rows.map((r) => r.lotId).filter((l) => l !== NIL_UUID))];
    const lots = lotIds.length
      ? await this.prisma.inventoryLot.findMany({ where: { organizationId, id: { in: lotIds } }, select: { id: true, lotNumber: true, expiryDate: true } })
      : [];
    const lotMap = new Map(lots.map((l) => [l.id, l]));

    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const canVal = user.permissions.includes(PERMISSIONS.VALUATION_VIEW);
    const q = filter.q?.trim().toLowerCase();

    const out: InventoryPositionRow[] = [];
    for (const b of rows) {
      const onHand = D(b.onHand);
      const reserved = D(b.reserved);
      const quarantined = D(b.quarantined);
      const damaged = D(b.damaged);
      const inTransit = D(b.inTransit);
      // Damaged is OUTSIDE onHand (ADR 0007) — never subtract it here.
      const available = onHand.sub(reserved).sub(quarantined);

      // Drop fully-drained rows: a position needs some quantity in some bucket.
      if (onHand.isZero() && reserved.isZero() && quarantined.isZero() && damaged.isZero() && inTransit.isZero()) continue;

      const lot = b.lotId === NIL_UUID ? null : lotMap.get(b.lotId) ?? null;
      const expiryDate = lot?.expiryDate ?? null;
      const expiryState = expiryStateOf(expiryDate);

      if (q && !(b.product.sku.toLowerCase().includes(q) || b.product.name.toLowerCase().includes(q) || (lot?.lotNumber ?? '').toLowerCase().includes(q))) continue;

      if (filter.hasStock && onHand.lte(ZERO) && inTransit.lte(ZERO) && quarantined.lte(ZERO) && damaged.lte(ZERO)) continue;

      if (filter.filter && !this.matchesPositionFilter(filter.filter, { onHand, reserved, quarantined, damaged, inTransit, available, expired: expiryState === 'EXPIRED' })) continue;

      const row: InventoryPositionRow = {
        productId: b.productId,
        productSku: b.product.sku,
        productName: b.product.name,
        isBatchTracked: b.product.isBatchTracked,
        variantId: b.variantId === NIL_UUID ? null : b.variantId,
        warehouseId: b.warehouseId,
        warehouseCode: b.warehouse.code,
        lotId: b.lotId === NIL_UUID ? null : b.lotId,
        lotNumber: lot?.lotNumber ?? null,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        expiryState,
        onHand: onHand.toString(),
        reserved: reserved.toString(),
        quarantined: quarantined.toString(),
        damaged: damaged.toString(),
        inTransit: inTransit.toString(),
        available: available.toString(),
      };
      if (canCost) row.avgCost = b.avgCost.toString();
      if (canVal) row.value = onHand.mul(D(b.avgCost)).toDecimalPlaces(4).toString();
      out.push(row);
    }
    return out;
  }

  private matchesPositionFilter(
    f: PositionFilter,
    v: { onHand: Prisma.Decimal; reserved: Prisma.Decimal; quarantined: Prisma.Decimal; damaged: Prisma.Decimal; inTransit: Prisma.Decimal; available: Prisma.Decimal; expired: boolean },
  ): boolean {
    switch (f) {
      case 'AVAILABLE': return v.available.gt(ZERO);
      case 'UNAVAILABLE': return v.available.lte(ZERO);
      case 'FULLY_RESERVED': return v.onHand.gt(ZERO) && v.reserved.gt(ZERO) && v.available.lte(ZERO);
      case 'QUARANTINED': return v.quarantined.gt(ZERO);
      case 'IN_TRANSIT_ONLY': return v.inTransit.gt(ZERO) && v.onHand.lte(ZERO);
      case 'NEGATIVE_ANOMALY':
        return v.onHand.lt(ZERO) || v.reserved.lt(ZERO) || v.quarantined.lt(ZERO) || v.damaged.lt(ZERO) || v.inTransit.lt(ZERO) || v.available.lt(ZERO);
      case 'EXPIRED_LOT': return v.expired && v.onHand.gt(ZERO);
      default: return true;
    }
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
