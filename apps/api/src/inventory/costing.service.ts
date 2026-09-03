import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, CostingStrategy, CostLayerStatus, MovementType } from '@prisma/client';
import type {
  CostLayerResponse,
  CostLayerConsumptionResponse,
  CostValuationRow,
  CostingPolicyResponse,
  CostingStrategy as CostingStrategyContract,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from './inventory.constants';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round4 = (d: Prisma.Decimal) => d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

/** Movement types that OPEN a cost layer under FIFO (inflows establishing new basis) — 2D.5A scope. */
const OPENS_LAYER = new Set<MovementType>([MovementType.OPENING_BALANCE, MovementType.PURCHASE_RECEIPT]);
/** Movement types that CONSUME cost layers under FIFO (outbound expensing) — 2D.5A scope. */
const CONSUMES_LAYER = new Set<MovementType>([MovementType.SALES_RELEASE]);

export interface FifoAllocation {
  costLayerId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  extendedCost: Prisma.Decimal;
}

@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  opensLayer(type: MovementType): boolean { return OPENS_LAYER.has(type); }
  consumesLayer(type: MovementType): boolean { return CONSUMES_LAYER.has(type); }

  /** Resolve the effective strategy for a product: per-product override → org default → WAC. */
  async strategyFor(tx: Tx, organizationId: string, productId: string): Promise<CostingStrategy> {
    const rows = await tx.costingPolicy.findMany({ where: { organizationId, productId: { in: [productId, NIL_UUID] } } });
    const specific = rows.find((r) => r.productId === productId);
    const orgDefault = rows.find((r) => r.productId === NIL_UUID);
    return (specific ?? orgDefault)?.strategy ?? CostingStrategy.WAC;
  }

  /** Open a cost layer for an inflow movement (ADR 0013 §4). */
  async openLayerInTx(
    tx: Tx,
    organizationId: string,
    opts: { productId: string; variantKey: string; warehouseId: string; sourceMovementId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; receivedAt: Date },
  ): Promise<void> {
    if (opts.quantity.lte(0)) return;
    await tx.costLayer.create({
      data: {
        organizationId, productId: opts.productId, variantId: opts.variantKey, warehouseId: opts.warehouseId,
        sourceMovementId: opts.sourceMovementId, receivedQuantity: opts.quantity, remainingQuantity: opts.quantity,
        unitCost: opts.unitCost, receivedAt: opts.receivedAt,
      },
    });
  }

  /**
   * Consume `quantity` from the oldest OPEN layers (received_at ASC, id ASC) under FOR UPDATE locks, decrement
   * their remaining, and return the COGS + the per-layer allocations (ADR 0013 §5). Fails safe if the layers
   * cannot cover the quantity. The consumption rows are written afterward with the outbound movement id.
   */
  async consumeFifoInTx(
    tx: Tx,
    organizationId: string,
    opts: { productId: string; variantKey: string; warehouseId: string; quantity: Prisma.Decimal },
  ): Promise<{ unitCost: Prisma.Decimal; totalCost: Prisma.Decimal; allocations: FifoAllocation[] }> {
    const rows = await tx.$queryRaw<Array<{ id: string; remaining: string; unit_cost: string }>>`
      SELECT id, remaining_quantity::text AS remaining, unit_cost::text AS unit_cost
      FROM cost_layers
      WHERE organization_id = ${organizationId}::uuid
        AND product_id = ${opts.productId}::uuid
        AND variant_id = ${opts.variantKey}::uuid
        AND warehouse_id = ${opts.warehouseId}::uuid
        AND status = 'OPEN'
        AND remaining_quantity > 0
      ORDER BY received_at ASC, id ASC
      FOR UPDATE`;

    let need = opts.quantity;
    let total = D(0);
    const allocations: FifoAllocation[] = [];
    for (const r of rows) {
      if (need.lte(0)) break;
      const remaining = D(r.remaining);
      const take = Prisma.Decimal.min(remaining, need);
      const unitCost = D(r.unit_cost);
      const extended = round4(take.mul(unitCost));
      allocations.push({ costLayerId: r.id, quantity: take, unitCost, extendedCost: extended });
      total = total.add(extended);
      need = need.sub(take);
      const newRemaining = remaining.sub(take);
      await tx.costLayer.update({
        where: { id: r.id },
        data: { remainingQuantity: newRemaining, ...(newRemaining.lte(0) ? { status: CostLayerStatus.DEPLETED } : {}) },
      });
    }
    if (need.gt(0)) {
      throw new BadRequestException(`Insufficient FIFO cost layers to value ${opts.quantity.toString()} unit(s) — ${need.toString()} uncosted`);
    }
    const unitCost = opts.quantity.gt(0) ? round4(total.div(opts.quantity)) : D(0);
    return { unitCost, totalCost: round4(total), allocations };
  }

  /** Persist the consumption records once the outbound movement id exists. */
  async recordConsumptionsInTx(tx: Tx, organizationId: string, outboundMovementId: string, allocations: FifoAllocation[]): Promise<void> {
    if (allocations.length === 0) return;
    await tx.costLayerConsumption.createMany({
      data: allocations.map((a) => ({ organizationId, costLayerId: a.costLayerId, outboundMovementId, quantity: a.quantity, unitCost: a.unitCost, extendedCost: a.extendedCost })),
    });
  }

  // -------------------------------------------------------------------------
  // Policy (ADR 0013 §2, §3)
  // -------------------------------------------------------------------------

  async getPolicy(organizationId: string, productId?: string): Promise<CostingPolicyResponse> {
    const key = productId ?? NIL_UUID;
    const row = await this.prisma.costingPolicy.findUnique({ where: { organizationId_productId: { organizationId, productId: key } } });
    if (!row) return { productId: productId ?? null, strategy: 'WAC', configured: false };
    return { productId: productId ?? null, strategy: row.strategy as CostingStrategyContract, configured: true };
  }

  /** Switching strategy requires zero physical stock for the scope (ADR 0013 §3). */
  async upsertPolicy(organizationId: string, strategy: CostingStrategyContract, productId?: string): Promise<CostingPolicyResponse> {
    const key = productId ?? NIL_UUID;
    const current = await this.strategyOf(organizationId, key);
    if (current !== strategy) {
      const onHand = await this.onHandFor(organizationId, productId);
      if (onHand.gt(0)) {
        throw new BadRequestException('Costing strategy can only be changed when on-hand stock is zero for the affected scope (ADR 0013). Deplete stock or run a revaluation first.');
      }
    }
    await this.prisma.costingPolicy.upsert({
      where: { organizationId_productId: { organizationId, productId: key } },
      create: { organizationId, productId: key, strategy: strategy as CostingStrategy },
      update: { strategy: strategy as CostingStrategy },
    });
    return this.getPolicy(organizationId, productId);
  }

  private async strategyOf(organizationId: string, productKey: string): Promise<CostingStrategyContract> {
    const row = await this.prisma.costingPolicy.findUnique({ where: { organizationId_productId: { organizationId, productId: productKey } } });
    if (row) return row.strategy as CostingStrategyContract;
    // Falling back to the org default when resolving a product-scope change.
    if (productKey !== NIL_UUID) {
      const def = await this.prisma.costingPolicy.findUnique({ where: { organizationId_productId: { organizationId, productId: NIL_UUID } } });
      return (def?.strategy as CostingStrategyContract) ?? 'WAC';
    }
    return 'WAC';
  }

  private async onHandFor(organizationId: string, productId?: string): Promise<Prisma.Decimal> {
    const rows = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, ...(productId ? { productId } : {}) },
      select: { onHand: true },
    });
    return rows.reduce((s, r) => s.add(r.onHand), D(0));
  }

  // -------------------------------------------------------------------------
  // Queries (cost.view-gated at the controller)
  // -------------------------------------------------------------------------

  async listLayers(organizationId: string, user: RequestUser, filter: { productId?: string; warehouseId?: string; status?: CostLayerStatus }): Promise<CostLayerResponse[]> {
    const scope = user.warehouseScope;
    const rows = await this.prisma.costLayer.findMany({
      where: {
        organizationId,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    return this.decorateLayers(organizationId, rows);
  }

  async consumptionsForMovement(organizationId: string, movementId: string): Promise<CostLayerConsumptionResponse[]> {
    const rows = await this.prisma.costLayerConsumption.findMany({ where: { organizationId, outboundMovementId: movementId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ id: r.id, costLayerId: r.costLayerId, outboundMovementId: r.outboundMovementId, quantity: r.quantity.toString(), unitCost: r.unitCost.toString(), extendedCost: r.extendedCost.toString() }));
  }

  async valuation(organizationId: string, user: RequestUser, filter: { productId?: string; warehouseId?: string }): Promise<CostValuationRow[]> {
    const scope = user.warehouseScope;
    const balances = await this.prisma.inventoryBalance.findMany({
      where: {
        organizationId,
        onHand: { gt: 0 },
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
      },
      select: { productId: true, variantId: true, warehouseId: true, onHand: true, avgCost: true, product: { select: { sku: true, name: true } }, warehouse: { select: { code: true } } },
    });
    // Aggregate balances to the cost-layer grain (product, variant, warehouse) — layers ignore lot.
    const grouped = new Map<string, { productId: string; variantId: string; warehouseId: string; onHand: Prisma.Decimal; wacValue: Prisma.Decimal; sku: string; name: string; code: string }>();
    for (const b of balances) {
      const key = `${b.productId}|${b.variantId}|${b.warehouseId}`;
      const g = grouped.get(key) ?? { productId: b.productId, variantId: b.variantId, warehouseId: b.warehouseId, onHand: D(0), wacValue: D(0), sku: b.product.sku, name: b.product.name, code: b.warehouse.code };
      g.onHand = g.onHand.add(b.onHand);
      g.wacValue = g.wacValue.add(D(b.onHand).mul(b.avgCost));
      grouped.set(key, g);
    }
    const productIds = [...new Set([...grouped.values()].map((g) => g.productId))];
    const strategyMap = await this.strategyMapFor(organizationId, productIds);
    // FIFO value per scope = Σ remaining × unitCost.
    const layers = await this.prisma.costLayer.findMany({
      where: { organizationId, status: CostLayerStatus.OPEN, remainingQuantity: { gt: 0 }, productId: { in: productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000'] } },
      select: { productId: true, variantId: true, warehouseId: true, remainingQuantity: true, unitCost: true },
    });
    const fifo = new Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal }>();
    for (const l of layers) {
      const key = `${l.productId}|${l.variantId}|${l.warehouseId}`;
      const f = fifo.get(key) ?? { qty: D(0), value: D(0) };
      f.qty = f.qty.add(l.remainingQuantity);
      f.value = f.value.add(D(l.remainingQuantity).mul(l.unitCost));
      fifo.set(key, f);
    }
    return [...grouped.values()].map((g) => {
      const key = `${g.productId}|${g.variantId}|${g.warehouseId}`;
      const f = fifo.get(key) ?? { qty: D(0), value: D(0) };
      const wacUnit = g.onHand.gt(0) ? round4(g.wacValue.div(g.onHand)) : D(0);
      return {
        productId: g.productId, productSku: g.sku, productName: g.name,
        variantId: g.variantId === NIL_UUID ? null : g.variantId,
        warehouseId: g.warehouseId, warehouseCode: g.code,
        strategy: (strategyMap.get(g.productId) ?? 'WAC') as CostingStrategyContract,
        onHand: g.onHand.toString(), wacUnitCost: wacUnit.toString(), wacValue: round4(g.wacValue).toString(),
        fifoLayerQuantity: f.qty.toString(), fifoValue: round4(f.value).toString(),
      };
    });
  }

  private async strategyMapFor(organizationId: string, productIds: string[]): Promise<Map<string, CostingStrategyContract>> {
    const rows = await this.prisma.costingPolicy.findMany({ where: { organizationId, productId: { in: [...productIds, NIL_UUID] } } });
    const orgDefault = (rows.find((r) => r.productId === NIL_UUID)?.strategy as CostingStrategyContract) ?? 'WAC';
    const map = new Map<string, CostingStrategyContract>();
    for (const pid of productIds) {
      const specific = rows.find((r) => r.productId === pid);
      map.set(pid, (specific?.strategy as CostingStrategyContract) ?? orgDefault);
    }
    return map;
  }

  private async decorateLayers(organizationId: string, rows: Array<{ id: string; productId: string; variantId: string; warehouseId: string; sourceMovementId: string; receivedQuantity: Prisma.Decimal; remainingQuantity: Prisma.Decimal; unitCost: Prisma.Decimal; receivedAt: Date; status: CostLayerStatus }>): Promise<CostLayerResponse[]> {
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
    const [products, warehouses] = await Promise.all([
      productIds.length ? this.prisma.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, sku: true } }) : Promise.resolve([]),
      warehouseIds.length ? this.prisma.warehouse.findMany({ where: { organizationId, id: { in: warehouseIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
    ]);
    const sku = new Map(products.map((p) => [p.id, p.sku]));
    const code = new Map(warehouses.map((w) => [w.id, w.code]));
    return rows.map((r) => ({
      id: r.id, productId: r.productId, productSku: sku.get(r.productId) ?? r.productId,
      variantId: r.variantId === NIL_UUID ? null : r.variantId,
      warehouseId: r.warehouseId, warehouseCode: code.get(r.warehouseId) ?? r.warehouseId,
      sourceMovementId: r.sourceMovementId, receivedQuantity: r.receivedQuantity.toString(), remainingQuantity: r.remainingQuantity.toString(),
      unitCost: r.unitCost.toString(), receivedAt: r.receivedAt.toISOString(), status: r.status as CostLayerResponse['status'],
    }));
  }
}
