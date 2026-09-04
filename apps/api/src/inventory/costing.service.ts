import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CostingStrategy, CostLayerStatus, MovementType } from '@prisma/client';
import type {
  CostLayerResponse,
  CostLayerConsumptionResponse,
  CostLayerConsumptionTraceResponse,
  CostLayerTraceResponse,
  CostDocumentRef,
  FifoCogsReportResponse,
  MovementCostDetailResponse,
  ReturnCostTraceResponse,
  TransferCostTraceResponse,
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

/** Inflows that carry their own explicit unit cost (a single layer at the received cost). */
const EXPLICIT_COST_INFLOW = new Set<MovementType>([
  MovementType.OPENING_BALANCE,
  MovementType.PURCHASE_RECEIPT,
  MovementType.STOCK_ADJUSTMENT_IN,
  MovementType.PRODUCTION_OUTPUT,
]);

/** Outflows that remove owned inventory value under FIFO. */
const FIFO_VALUE_OUTFLOW = new Set<MovementType>([
  MovementType.SALES_RELEASE,
  MovementType.TRANSFER_OUT,
  MovementType.SUPPLIER_RETURN,
  MovementType.STOCK_ADJUSTMENT_OUT,
  MovementType.DAMAGE,
  MovementType.EXPIRY,
  MovementType.PRODUCTION_CONSUMPTION,
  MovementType.PROJECT_ISSUE,
  MovementType.INTERNAL_CONSUMPTION,
  MovementType.RETURN_DISPOSE,
]);

export interface FifoAllocation {
  costLayerId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  extendedCost: Prisma.Decimal;
}

/** A preserved/restored cost composition — the quantities and their unit costs (ADR 0013 §7). */
export interface CostBasisComponent {
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

@Injectable()
export class CostingService {
  constructor(private readonly prisma: PrismaService) {}

  explicitCostInflow(type: MovementType): boolean { return EXPLICIT_COST_INFLOW.has(type); }
  consumesLayer(type: MovementType): boolean { return FIFO_VALUE_OUTFLOW.has(type); }

  /** Resolve the effective strategy for a product: per-product override → org default → WAC. */
  async strategyFor(tx: Tx, organizationId: string, productId: string): Promise<CostingStrategy> {
    const rows = await tx.costingPolicy.findMany({ where: { organizationId, productId: { in: [productId, NIL_UUID] } } });
    const specific = rows.find((r) => r.productId === productId);
    const orgDefault = rows.find((r) => r.productId === NIL_UUID);
    return (specific ?? orgDefault)?.strategy ?? CostingStrategy.WAC;
  }

  /** Open one or more cost layers for an inflow movement (ADR 0013 §4, §7). A single receipt passes one
   *  component; a transfer-in / traceable return passes the preserved/restored multi-component basis. */
  async openLayersInTx(
    tx: Tx,
    organizationId: string,
    opts: { productId: string; variantKey: string; warehouseId: string; sourceMovementId: string; receivedAt: Date; basis: CostBasisComponent[] },
  ): Promise<void> {
    const rows = opts.basis
      .filter((b) => b.quantity.gt(0))
      .map((b, i) => ({
        organizationId, productId: opts.productId, variantId: opts.variantKey, warehouseId: opts.warehouseId,
        sourceMovementId: opts.sourceMovementId, receivedQuantity: b.quantity, remainingQuantity: b.quantity,
        unitCost: b.unitCost, receivedAt: new Date(opts.receivedAt.getTime() + i),
      }));
    if (rows.length) await tx.costLayer.createMany({ data: rows });
  }

  /** The cost composition an outbound movement consumed, oldest-first — the captured basis a transfer or a
   *  traceable return preserves/restores (ADR 0013 §7). Aggregated by unit cost, order preserved. */
  async basisFromMovementInTx(tx: Tx, organizationId: string, outboundMovementId: string): Promise<CostBasisComponent[]> {
    const rows = await tx.costLayerConsumption.findMany({
      where: { organizationId, outboundMovementId },
      orderBy: [{ costLayer: { receivedAt: 'asc' } }, { costLayerId: 'asc' }],
      select: { quantity: true, unitCost: true },
    });
    const out: CostBasisComponent[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.unitCost.equals(r.unitCost)) last.quantity = last.quantity.add(r.quantity);
      else out.push({ quantity: D(r.quantity), unitCost: D(r.unitCost) });
    }
    return out;
  }

  /** Restore a prefix of an origin movement's consumed basis for `quantity` units (a partial return, oldest
   *  original cost first). Used to restore original issue cost on a traceable return (ADR 0013 §7). */
  async basisAllocatedFromMovementInTx(tx: Tx, organizationId: string, originMovementId: string, quantity: Prisma.Decimal): Promise<CostBasisComponent[] | null> {
    const full = await this.basisFromMovementInTx(tx, organizationId, originMovementId);
    if (full.length === 0) return null; // origin had no FIFO consumption (e.g., was WAC at the time)
    let need = quantity;
    const out: CostBasisComponent[] = [];
    for (const c of full) {
      if (need.lte(0)) break;
      const take = Prisma.Decimal.min(c.quantity, need);
      out.push({ quantity: take, unitCost: c.unitCost });
      need = need.sub(take);
    }
    if (need.gt(0)) return null; // origin cannot cover the returned quantity — caller falls back / rejects
    return out;
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

  async listLayers(organizationId: string, user: RequestUser, filter: { productId?: string; warehouseId?: string; status?: CostLayerStatus; from?: string; to?: string }): Promise<CostLayerResponse[]> {
    const scope = user.warehouseScope;
    const rows = await this.prisma.costLayer.findMany({
      where: {
        organizationId,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.from || filter.to ? { receivedAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } } : {}),
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    return this.decorateLayers(organizationId, rows);
  }

  async consumptionsForMovement(organizationId: string, user: RequestUser, movementId: string): Promise<CostLayerConsumptionResponse[]> {
    const movement = await this.prisma.inventoryMovement.findFirst({
      where: { id: movementId, organizationId },
      select: { warehouseId: true },
    });
    if (!movement) throw new NotFoundException('Movement not found');
    this.assertWarehouseInScope(user, movement.warehouseId);
    const rows = await this.prisma.costLayerConsumption.findMany({ where: { organizationId, outboundMovementId: movementId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ id: r.id, costLayerId: r.costLayerId, outboundMovementId: r.outboundMovementId, quantity: r.quantity.toString(), unitCost: r.unitCost.toString(), extendedCost: r.extendedCost.toString() }));
  }

  async layerTrace(organizationId: string, user: RequestUser, layerId: string): Promise<CostLayerTraceResponse> {
    const layer = await this.prisma.costLayer.findFirst({ where: { id: layerId, organizationId } });
    if (!layer) throw new NotFoundException('Cost layer not found');
    this.assertWarehouseInScope(user, layer.warehouseId);
    const sourceMovement = await this.prisma.inventoryMovement.findFirst({
      where: { id: layer.sourceMovementId, organizationId },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
    });
    if (!sourceMovement) throw new NotFoundException('Source movement not found');
    const [decorated] = await this.decorateLayers(organizationId, [layer]);
    return {
      layer: decorated!,
      sourceMovement: {
        id: sourceMovement.id,
        txnNumber: sourceMovement.txnNumber,
        movementType: sourceMovement.movementType,
        referenceType: sourceMovement.referenceType,
        referenceId: sourceMovement.referenceId,
        postedAt: sourceMovement.postedAt.toISOString(),
      },
      sourceDocument: await this.documentRefForMovement(this.prisma, organizationId, sourceMovement),
    };
  }

  async movementCostDetail(organizationId: string, user: RequestUser, movementId: string): Promise<MovementCostDetailResponse> {
    const movement = await this.prisma.inventoryMovement.findFirst({
      where: { id: movementId, organizationId },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
    });
    if (!movement) throw new NotFoundException('Movement not found');
    this.assertWarehouseInScope(user, movement.warehouseId);
    return this.movementCostDetailFromMovement(organizationId, movement);
  }

  async fifoCogsReport(
    organizationId: string,
    user: RequestUser,
    filter: { from?: string; to?: string; productId?: string; warehouseId?: string },
  ): Promise<FifoCogsReportResponse> {
    const scope = user.warehouseScope;
    const consumptionRows = await this.prisma.costLayerConsumption.findMany({
      where: { organizationId },
      select: { outboundMovementId: true },
      distinct: ['outboundMovementId'],
      take: 500,
    });
    const movementIds = consumptionRows.map((r) => r.outboundMovementId);
    const rows = movementIds.length ? await this.prisma.inventoryMovement.findMany({
      where: {
        organizationId,
        id: { in: movementIds },
        movementType: { not: MovementType.TRANSFER_OUT },
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
        postedAt: {
          ...(filter.from ? { gte: new Date(filter.from) } : {}),
          ...(filter.to ? { lte: new Date(filter.to) } : {}),
        },
      },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: { postedAt: 'desc' },
      take: 500,
    }) : [];
    let total = D(0);
    const reportRows: FifoCogsReportResponse['rows'] = [];
    for (const m of rows) {
      total = total.add(m.totalCost);
      reportRows.push({
        movementId: m.id,
        txnNumber: m.txnNumber,
        movementType: m.movementType,
        productId: m.productId,
        productSku: m.product.sku,
        warehouseId: m.warehouseId,
        warehouseCode: m.warehouse.code,
        quantity: m.quantity.toString(),
        totalCost: m.totalCost.toString(),
        postedAt: m.postedAt.toISOString(),
        sourceDocument: await this.documentRefForMovement(this.prisma, organizationId, m),
      });
    }
    return { from: filter.from ?? null, to: filter.to ?? null, totalCogs: round4(total).toString(), rows: reportRows };
  }

  async transferTrace(organizationId: string, user: RequestUser, transferId: string): Promise<TransferCostTraceResponse> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId, organizationId },
      include: { items: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    this.assertWarehouseInScope(user, transfer.sourceWarehouseId);
    this.assertWarehouseInScope(user, transfer.destWarehouseId);
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { organizationId, referenceType: 'stock_transfer', referenceId: transfer.id },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: { postedAt: 'asc' },
    });
    const outs = movements.filter((m) => m.movementType === MovementType.TRANSFER_OUT);
    const destIns = movements.filter((m) => m.movementType === MovementType.TRANSFER_IN && m.onHandDelta.gt(0));
    const lines: TransferCostTraceResponse['lines'] = [];
    for (let i = 0; i < transfer.items.length; i += 1) {
      const item = transfer.items[i]!;
      const out = outs[i];
      const destIn = destIns[i] ?? null;
      const destLayers = destIn
        ? await this.prisma.costLayer.findMany({ where: { organizationId, sourceMovementId: destIn.id }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] })
        : [];
      lines.push({
        productId: item.productId,
        productSku: item.product.sku,
        quantity: item.quantity.toString(),
        sourceMovementId: out?.id ?? '',
        destinationMovementId: destIn?.id ?? null,
        sourceConsumptions: out ? await this.consumptionTraceRows(organizationId, out.id) : [],
        destinationLayers: await this.decorateLayers(organizationId, destLayers),
      });
    }
    return { transfer: { type: 'stock_transfer', id: transfer.id, number: transfer.transferNumber }, lines };
  }

  async returnTrace(organizationId: string, user: RequestUser, returnId: string): Promise<ReturnCostTraceResponse> {
    const ret = await this.prisma.inventoryReturn.findFirst({
      where: { id: returnId, organizationId },
      include: { lines: { include: { product: { select: { sku: true } } }, orderBy: { id: 'asc' } } },
    });
    if (!ret) throw new NotFoundException('Return not found');
    this.assertWarehouseInScope(user, ret.warehouseId);
    const receiptMovements = await this.prisma.inventoryMovement.findMany({
      where: { organizationId, referenceType: 'inventory_return', referenceId: ret.id, movementType: MovementType.RETURN_RECEIPT },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: { postedAt: 'asc' },
    });
    const lines: ReturnCostTraceResponse['lines'] = [];
    for (let i = 0; i < ret.lines.length; i += 1) {
      const line = ret.lines[i]!;
      const receipt = receiptMovements[i] ?? null;
      const restored = receipt
        ? await this.prisma.costLayer.findMany({ where: { organizationId, sourceMovementId: receipt.id }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] })
        : [];
      const originalIssueMovements: ReturnCostTraceResponse['lines'][number]['originalIssueMovements'] = [];
      for (const serialNumber of line.serialNumbers) {
        const issue = await this.issueMovementForSerial(organizationId, line.productId, line.variantId, serialNumber, ret.receivedAt ?? ret.createdAt);
        originalIssueMovements.push({
          serialNumber,
          movement: issue ? (await this.movementCostDetailFromMovement(organizationId, issue)).movement : null,
        });
      }
      lines.push({
        productId: line.productId,
        productSku: line.product.sku,
        serialNumbers: line.serialNumbers,
        receiptMovementId: receipt?.id ?? null,
        originalIssueMovements,
        restoredLayers: await this.decorateLayers(organizationId, restored),
      });
    }
    return { return: { type: 'inventory_return', id: ret.id, number: ret.returnNo }, lines };
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
    const sourceMovementIds = [...new Set(rows.map((r) => r.sourceMovementId))];
    const [products, warehouses, sourceMovements] = await Promise.all([
      productIds.length ? this.prisma.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, sku: true } }) : Promise.resolve([]),
      warehouseIds.length ? this.prisma.warehouse.findMany({ where: { organizationId, id: { in: warehouseIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
      sourceMovementIds.length ? this.prisma.inventoryMovement.findMany({ where: { organizationId, id: { in: sourceMovementIds } } }) : Promise.resolve([]),
    ]);
    const sku = new Map(products.map((p) => [p.id, p.sku]));
    const code = new Map(warehouses.map((w) => [w.id, w.code]));
    const movementMap = new Map(sourceMovements.map((m) => [m.id, m]));
    const docRefs = new Map<string, CostDocumentRef | null>();
    for (const m of sourceMovements) docRefs.set(m.id, await this.documentRefForMovement(this.prisma, organizationId, m));
    return rows.map((r) => {
      const remainingValue = round4(D(r.remainingQuantity).mul(r.unitCost)).toString();
      return {
        id: r.id, productId: r.productId, productSku: sku.get(r.productId) ?? r.productId,
        variantId: r.variantId === NIL_UUID ? null : r.variantId,
        warehouseId: r.warehouseId, warehouseCode: code.get(r.warehouseId) ?? r.warehouseId,
        sourceMovementId: r.sourceMovementId, receivedQuantity: r.receivedQuantity.toString(), remainingQuantity: r.remainingQuantity.toString(),
        unitCost: r.unitCost.toString(), receivedAt: r.receivedAt.toISOString(), status: r.status as CostLayerResponse['status'],
        remainingValue,
        sourceDocument: movementMap.has(r.sourceMovementId) ? docRefs.get(r.sourceMovementId) ?? null : null,
      };
    });
  }

  private assertWarehouseInScope(user: RequestUser, warehouseId: string): void {
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
  }

  private async consumptionTraceRows(organizationId: string, movementId: string): Promise<CostLayerConsumptionTraceResponse[]> {
    const rows = await this.prisma.costLayerConsumption.findMany({
      where: { organizationId, outboundMovementId: movementId },
      include: { costLayer: true },
      orderBy: [{ costLayer: { receivedAt: 'asc' } }, { costLayerId: 'asc' }],
    });
    const sourceMovements = rows.length ? await this.prisma.inventoryMovement.findMany({
      where: { organizationId, id: { in: [...new Set(rows.map((r) => r.costLayer.sourceMovementId))] } },
    }) : [];
    const byId = new Map(sourceMovements.map((m) => [m.id, m]));
    const refs = new Map<string, CostDocumentRef | null>();
    for (const m of sourceMovements) refs.set(m.id, await this.documentRefForMovement(this.prisma, organizationId, m));
    return rows.map((r) => ({
      id: r.id,
      costLayerId: r.costLayerId,
      outboundMovementId: r.outboundMovementId,
      quantity: r.quantity.toString(),
      unitCost: r.unitCost.toString(),
      extendedCost: r.extendedCost.toString(),
      layerReceivedAt: r.costLayer.receivedAt.toISOString(),
      layerSourceMovementId: r.costLayer.sourceMovementId,
      layerSourceDocument: byId.has(r.costLayer.sourceMovementId) ? refs.get(r.costLayer.sourceMovementId) ?? null : null,
    }));
  }

  private async movementCostDetailFromMovement(
    organizationId: string,
    movement: { id: string; txnNumber: string; movementType: MovementType; productId: string; warehouseId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal; totalCost: Prisma.Decimal; referenceType: string | null; referenceId: string | null; postedAt: Date; product: { sku: string }; warehouse: { code: string } },
  ): Promise<MovementCostDetailResponse> {
    return {
      movement: {
        id: movement.id,
        txnNumber: movement.txnNumber,
        movementType: movement.movementType,
        productId: movement.productId,
        productSku: movement.product.sku,
        warehouseId: movement.warehouseId,
        warehouseCode: movement.warehouse.code,
        quantity: movement.quantity.toString(),
        unitCost: movement.unitCost.toString(),
        totalCost: movement.totalCost.toString(),
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        postedAt: movement.postedAt.toISOString(),
      },
      sourceDocument: await this.documentRefForMovement(this.prisma, organizationId, movement),
      consumptions: await this.consumptionTraceRows(organizationId, movement.id),
    };
  }

  private async issueMovementForSerial(
    organizationId: string,
    productId: string,
    variantId: string,
    serialNumber: string,
    before: Date,
  ): Promise<({ product: { sku: string }; warehouse: { code: string } } & Awaited<ReturnType<PrismaService['inventoryMovement']['findFirst']>>) | null> {
    const releaseItem = await this.prisma.stockReleaseItem.findFirst({
      where: { organizationId, productId, variantId: variantId === NIL_UUID ? null : variantId, serialNumbers: { has: serialNumber }, release: { postedAt: { lte: before } } },
      include: { release: { select: { id: true, postedAt: true } } },
      orderBy: { release: { postedAt: 'desc' } },
    });
    if (!releaseItem) return null;
    return this.prisma.inventoryMovement.findFirst({
      where: {
        organizationId,
        referenceType: 'stock_release',
        referenceId: releaseItem.release.id,
        productId,
        variantId: variantId === NIL_UUID ? null : variantId,
        movementType: MovementType.SALES_RELEASE,
      },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: { postedAt: 'desc' },
    }) as never;
  }

  private async documentRefForMovement(tx: Tx, organizationId: string, movement: { referenceType: string | null; referenceId: string | null; txnNumber?: string }): Promise<CostDocumentRef | null> {
    if (!movement.referenceType || !movement.referenceId) return { type: 'inventory_movement', id: null, number: movement.txnNumber ?? null };
    switch (movement.referenceType) {
      case 'goods_receipt': {
        const r = await tx.goodsReceipt.findFirst({ where: { id: movement.referenceId, organizationId }, select: { id: true, receiptNumber: true } });
        return { type: 'goods_receipt', id: r?.id ?? movement.referenceId, number: r?.receiptNumber ?? null };
      }
      case 'stock_release': {
        const r = await tx.stockRelease.findFirst({ where: { id: movement.referenceId, organizationId }, select: { id: true, releaseNumber: true } });
        return { type: 'stock_release', id: r?.id ?? movement.referenceId, number: r?.releaseNumber ?? null };
      }
      case 'stock_transfer': {
        const r = await tx.stockTransfer.findFirst({ where: { id: movement.referenceId, organizationId }, select: { id: true, transferNumber: true } });
        return { type: 'stock_transfer', id: r?.id ?? movement.referenceId, number: r?.transferNumber ?? null };
      }
      case 'inventory_return': {
        const r = await tx.inventoryReturn.findFirst({ where: { id: movement.referenceId, organizationId }, select: { id: true, returnNo: true } });
        return { type: 'inventory_return', id: r?.id ?? movement.referenceId, number: r?.returnNo ?? null };
      }
      case 'stock_adjustment': {
        const r = await tx.stockAdjustment.findFirst({ where: { id: movement.referenceId, organizationId }, select: { id: true, adjustmentNumber: true } });
        return { type: 'stock_adjustment', id: r?.id ?? movement.referenceId, number: r?.adjustmentNumber ?? null };
      }
      case 'stock_count': {
        const r = await tx.stockCount.findFirst({ where: { id: movement.referenceId, organizationId }, select: { id: true, countNumber: true } });
        return { type: 'stock_count', id: r?.id ?? movement.referenceId, number: r?.countNumber ?? null };
      }
      default:
        return { type: movement.referenceType, id: movement.referenceId, number: null };
    }
  }
}
