import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CountStatus, CountType, MovementType, SerialStatus } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { CountListItem, CountResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { SerialsService } from '../serials/serials.service';
import { NIL_UUID } from '../inventory/inventory.constants';
import { CreateCountDto, EnterCountsDto } from './dto/count.dto';

type CountWithItems = Prisma.StockCountGetPayload<{
  include: {
    warehouse: { select: { code: true } };
    items: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

@Injectable()
export class CountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly posting: InventoryPostingService,
    private readonly outbox: OutboxService,
    private readonly serials: SerialsService,
  ) {}

  /** Whether a product is serial-counted (serialized AND capture-at-receipt — the in-stock-tracked case). */
  private async serialCountedProducts(organizationId: string, productIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return new Set();
    const products = await this.prisma.product.findMany({ where: { organizationId, id: { in: ids }, isSerialized: true }, select: { id: true } });
    const policyMap = await this.serials.policyMapFor(organizationId, products.map((p) => p.id));
    return new Set(products.filter((p) => (policyMap.get(p.id)?.captureMode ?? 'RECEIPT') === 'RECEIPT').map((p) => p.id));
  }

  async list(organizationId: string, user: RequestUser): Promise<CountListItem[]> {
    const scope = user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;
    const rows = await this.prisma.stockCount.findMany({
      where: { organizationId, ...(scope ? { warehouseId: scope } : {}) },
      include: { warehouse: { select: { code: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => ({
      id: c.id,
      countNumber: c.countNumber,
      warehouseCode: c.warehouse.code,
      type: c.type as CountType,
      isBlind: c.isBlind,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      lineCount: c._count.items,
    }));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<CountResponse> {
    const count = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, count.warehouseId);
    return this.toResponse(count, user);
  }

  async create(organizationId: string, user: RequestUser, dto: CreateCountDto): Promise<CountResponse> {
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);

    // Snapshot expected quantities PER LOT (ADR 0007): batch-tracked stock is counted product+lot, so
    // lot redistribution with a correct product total still surfaces as variance. Non-batch stock has one
    // NIL-lot row per product. Each balance row becomes one count item carrying its lotId.
    const snapshot: Array<{ productId: string; variantId: string | null; lotId: string | null; systemQty: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
    const pushRow = (b: { productId: string; variantId: string; lotId: string; onHand: Prisma.Decimal; avgCost: Prisma.Decimal }) =>
      snapshot.push({
        productId: b.productId,
        variantId: b.variantId === NIL_UUID ? null : b.variantId,
        lotId: b.lotId === NIL_UUID ? null : b.lotId,
        systemQty: new Prisma.Decimal(b.onHand),
        unitCost: new Prisma.Decimal(b.avgCost),
      });
    if (dto.productIds && dto.productIds.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { organizationId, id: { in: dto.productIds } },
        select: { id: true },
      });
      if (products.length !== new Set(dto.productIds).size) {
        throw new BadRequestException('One or more products not found');
      }
      for (const productId of [...new Set(dto.productIds)]) {
        const rows = await this.prisma.inventoryBalance.findMany({
          where: { organizationId, productId, warehouseId: dto.warehouseId },
          select: { productId: true, variantId: true, lotId: true, onHand: true, avgCost: true },
        });
        if (rows.length === 0) {
          snapshot.push({ productId, variantId: null, lotId: null, systemQty: new Prisma.Decimal(0), unitCost: new Prisma.Decimal(0) });
        } else {
          rows.forEach(pushRow);
        }
      }
    } else {
      const balances = await this.prisma.inventoryBalance.findMany({
        where: { organizationId, warehouseId: dto.warehouseId },
        select: { productId: true, variantId: true, lotId: true, onHand: true, avgCost: true },
      });
      balances.forEach(pushRow);
    }

    // Snapshot the expected IN_STOCK serial set for each serial-counted item (ADR 0012 §9). Counting then
    // reconciles serial identities, not just a quantity.
    const serialCounted = await this.serialCountedProducts(organizationId, snapshot.map((s) => s.productId));
    const itemData = await Promise.all(snapshot.map(async (s) => ({
      organizationId,
      productId: s.productId,
      variantId: s.variantId,
      lotId: s.lotId,
      systemQty: s.systemQty,
      unitCost: s.unitCost,
      expectedSerials: serialCounted.has(s.productId)
        ? await this.serials.inStockSerials(organizationId, s.productId, s.variantId ?? NIL_UUID, dto.warehouseId, s.lotId)
        : [],
    })));

    const countNumber = await this.nextNumber(organizationId);
    const count = await this.prisma.stockCount.create({
      data: {
        organizationId,
        countNumber,
        warehouseId: dto.warehouseId,
        type: (dto.type ?? 'WAREHOUSE') as CountType,
        isBlind: dto.isBlind ?? false,
        notes: dto.notes ?? null,
        requestorId: user.userId,
        items: { create: itemData },
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_count.created',
      entityType: 'stock_count',
      entityId: count.id,
      newValue: { countNumber, warehouseId: dto.warehouseId, lines: snapshot.length },
    });
    return this.get(organizationId, user, count.id);
  }

  /**
   * Snapshot exactly ONE counting scope for a cycle-count task (2C.3B, ADR 0009 §6). Batch scope →
   * warehouse/product/variant/lot; non-lot scope → warehouse/product/variant (lotId = NIL). The count is
   * the single authoritative StockCount for the task (unique cycleCountTaskId); it flows through the same
   * count/submit/approve/post path — no duplicate variance logic.
   */
  async createCycleCount(
    organizationId: string,
    user: RequestUser,
    scope: { warehouseId: string; productId: string; variantId: string; lotId: string },
    cycleCountTaskId: string,
  ): Promise<CountResponse> {
    const rows = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, warehouseId: scope.warehouseId, productId: scope.productId, variantId: scope.variantId, lotId: scope.lotId },
      select: { onHand: true, avgCost: true },
    });
    const serialCounted = await this.serialCountedProducts(organizationId, [scope.productId]);
    const lotId = scope.lotId === NIL_UUID ? null : scope.lotId;
    const expectedSerials = serialCounted.has(scope.productId)
      ? await this.serials.inStockSerials(organizationId, scope.productId, scope.variantId, scope.warehouseId, lotId)
      : [];
    const items = rows.length
      ? rows.map((r) => ({
          organizationId, productId: scope.productId,
          variantId: scope.variantId === NIL_UUID ? null : scope.variantId,
          lotId, systemQty: new Prisma.Decimal(r.onHand), unitCost: new Prisma.Decimal(r.avgCost), expectedSerials,
        }))
      : [{
          organizationId, productId: scope.productId,
          variantId: scope.variantId === NIL_UUID ? null : scope.variantId,
          lotId, systemQty: new Prisma.Decimal(0), unitCost: new Prisma.Decimal(0), expectedSerials,
        }];

    const countNumber = await this.nextNumber(organizationId);
    const count = await this.prisma.stockCount.create({
      data: {
        organizationId, countNumber, warehouseId: scope.warehouseId, type: CountType.CYCLE,
        isBlind: false, requestorId: user.userId, cycleCountTaskId,
        items: { create: items },
      },
    });
    return this.get(organizationId, user, count.id);
  }

  async enterCounts(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: EnterCountsDto,
  ): Promise<CountResponse> {
    const count = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, count.warehouseId);
    this.assertStatus(count, [CountStatus.COUNTING], 'counted');

    const byId = new Map(count.items.map((i) => [i.id, i]));
    for (const entry of dto.items) {
      if (!byId.has(entry.itemId)) throw new BadRequestException(`Item ${entry.itemId} not in this count`);
    }
    const serialCounted = await this.serialCountedProducts(organizationId, count.items.map((i) => i.productId));
    // A serialized item's counted quantity IS the observed serial-set size (identity, not just a number).
    const updates = dto.items.map((entry) => {
      const item = byId.get(entry.itemId)!;
      if (serialCounted.has(item.productId)) {
        const observed = this.serials.normalize(entry.observedSerials ?? [], item.productId);
        return this.prisma.stockCountItem.update({
          where: { id: entry.itemId },
          data: { observedSerials: observed, countedQty: new Prisma.Decimal(observed.length) },
        });
      }
      if (entry.countedQty === undefined) throw new BadRequestException(`Item ${entry.itemId} requires a counted quantity`);
      return this.prisma.stockCountItem.update({ where: { id: entry.itemId }, data: { countedQty: entry.countedQty } });
    });
    await this.prisma.$transaction(updates);
    return this.get(organizationId, user, id);
  }

  async submit(organizationId: string, user: RequestUser, id: string): Promise<CountResponse> {
    const count = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, count.warehouseId);
    this.assertStatus(count, [CountStatus.COUNTING], 'submitted');
    const uncounted = count.items.filter((i) => i.countedQty === null).length;
    if (uncounted > 0) {
      throw new BadRequestException(`${uncounted} item(s) have not been counted yet`);
    }
    await this.prisma.stockCount.update({ where: { id }, data: { status: CountStatus.REVIEW } });
    return this.get(organizationId, user, id);
  }

  async approve(organizationId: string, user: RequestUser, id: string): Promise<CountResponse> {
    const count = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, count.warehouseId);
    this.assertStatus(count, [CountStatus.REVIEW], 'approved');
    await this.prisma.stockCount.update({
      where: { id },
      data: { status: CountStatus.APPROVED, approvedById: user.userId },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_count.approved',
      entityType: 'stock_count',
      entityId: id,
    });
    return this.get(organizationId, user, id);
  }

  /** Posts count variances to the ledger as ADJUSTMENT_IN / ADJUSTMENT_OUT. */
  async post(
    organizationId: string,
    user: RequestUser,
    id: string,
    idempotencyKey?: string,
  ): Promise<CountResponse> {
    const count = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, count.warehouseId);
    if (count.status === CountStatus.POSTED) return this.toResponse(count, user);
    this.assertStatus(count, [CountStatus.APPROVED], 'posted');

    // Serial-counted items reconcile by IDENTITY: serials expected-but-not-observed are losses (→ DISPOSED
    // via ADJUSTMENT_OUT), observed-but-not-expected are finds (→ registered IN_STOCK via ADJUSTMENT_IN).
    // Every posting + serial transition commits in ONE transaction, so quantity never reconciles while the
    // serial identity is wrong (ADR 0012 §8, §9). Non-serialized items keep the plain quantity-variance path.
    const serialCounted = await this.serialCountedProducts(organizationId, count.items.map((i) => i.productId));
    const key = idempotencyKey ?? `physical_count:${count.id}`;
    let firstKeyUsed = false;
    let inCount = 0;
    let outCount = 0;
    const postLine = (
      tx: Prisma.TransactionClient,
      movementType: MovementType,
      item: { productId: string; variantId: string | null; lotId: string | null; unitCost: Prisma.Decimal },
      quantity: Prisma.Decimal,
      withCost: boolean,
    ) => {
      const p = this.posting.postLineInTx(
        tx,
        { organizationId, actorId: user.userId, idempotencyKey: firstKeyUsed ? null : key },
        {
          movementType, warehouseId: count.warehouseId, referenceType: 'stock_count', referenceId: count.id,
          line: { productId: item.productId, variantId: item.variantId, quantity, unitCost: withCost ? item.unitCost : null, lotId: item.lotId },
        },
      );
      firstKeyUsed = true;
      return p;
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const item of count.items) {
          const variantKey = item.variantId ?? NIL_UUID;
          if (serialCounted.has(item.productId)) {
            const observed = new Set(item.observedSerials);
            const expected = new Set(item.expectedSerials);
            const missing = item.expectedSerials.filter((s) => !observed.has(s));
            const extra = item.observedSerials.filter((s) => !expected.has(s));
            if (missing.length > 0) {
              const m = await postLine(tx, MovementType.STOCK_ADJUSTMENT_OUT, item, new Prisma.Decimal(missing.length), false);
              outCount += 1;
              await this.serials.transitionExistingInTx(tx, organizationId, {
                productId: item.productId, variantKey, serialNumbers: missing,
                expectFrom: [SerialStatus.IN_STOCK], to: SerialStatus.DISPOSED, requireWarehouseId: count.warehouseId, movementId: m.id,
              });
            }
            if (extra.length > 0) {
              const m = await postLine(tx, MovementType.STOCK_ADJUSTMENT_IN, item, new Prisma.Decimal(extra.length), true);
              inCount += 1;
              await this.serials.createSerialsInTx(tx, organizationId, {
                productId: item.productId, variantKey, lotId: item.lotId, serialNumbers: extra,
                status: SerialStatus.IN_STOCK, warehouseId: count.warehouseId, movementId: m.id, received: true,
              });
            }
          } else {
            const counted = item.countedQty ?? item.systemQty;
            const variance = new Prisma.Decimal(counted).sub(item.systemQty);
            if (variance.gt(0)) { await postLine(tx, MovementType.STOCK_ADJUSTMENT_IN, item, variance, true); inCount += 1; }
            else if (variance.lt(0)) { await postLine(tx, MovementType.STOCK_ADJUSTMENT_OUT, item, variance.abs(), false); outCount += 1; }
          }
        }
        await tx.stockCount.update({ where: { id }, data: { status: CountStatus.POSTED, postedAt: new Date() } });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        const already = await this.load(organizationId, id);
        if (already.status === CountStatus.POSTED) return this.toResponse(already, user);
      }
      throw e;
    }
    // Cycle-counting completion (2C.3B, ADR 0009 §6): a task COMPLETES only after its count POSTS. The
    // completion flip AND its CycleCountCompleted outbox event commit atomically (ADR 0010, 2D.1C) — if the
    // completion rolls back, the event disappears with it. The variance already went through the ledger.
    if (count.cycleCountTaskId) {
      const item = count.items[0];
      const expected = item ? new Prisma.Decimal(item.systemQty) : new Prisma.Decimal(0);
      const counted = item ? new Prisma.Decimal(item.countedQty ?? item.systemQty) : new Prisma.Decimal(0);
      const variance = counted.sub(expected);
      const taskId = count.cycleCountTaskId;
      await this.prisma.$transaction(async (tx) => {
        const task = await tx.cycleCountTask.update({
          where: { id: taskId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await this.outbox.enqueue(tx, {
          organizationId,
          eventType: 'CycleCountCompleted',
          aggregateType: 'cycle_count_task',
          aggregateId: task.id,
          dedupeKey: `cycle-count-completed:${task.id}`,
          payload: {
            cycleCountTaskId: task.id, stockCountId: count.id, warehouseId: count.warehouseId,
            productId: item?.productId ?? null, variantId: item?.variantId ?? null, lotId: item?.lotId ?? null,
            abcClass: task.abcClass, assignedToId: task.assignedToId ?? null,
            expectedQuantity: expected.toString(), countedQuantity: counted.toString(),
            varianceQuantity: variance.toString(), completedAt: task.completedAt ? task.completedAt.toISOString() : null,
          },
        });
      });
    }
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_count.posted',
      entityType: 'stock_count',
      entityId: id,
      newValue: { in: inCount, out: outCount, cycleCountTaskId: count.cycleCountTaskId ?? null },
    });
    return this.get(organizationId, user, id);
  }

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<CountResponse> {
    const count = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, count.warehouseId);
    if (count.status === CountStatus.POSTED) {
      throw new BadRequestException('A posted count cannot be cancelled');
    }
    await this.prisma.stockCount.update({ where: { id }, data: { status: CountStatus.CANCELLED } });
    return this.get(organizationId, user, id);
  }

  // ---- helpers ----

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private assertStatus(count: CountWithItems, allowed: CountStatus[], verb: string): void {
    if (!allowed.includes(count.status)) {
      throw new BadRequestException(`A ${count.status} count cannot be ${verb}`);
    }
  }

  private async nextNumber(organizationId: string): Promise<string> {
    const seq = await this.prisma.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'stock_count' } },
      create: { organizationId, key: 'stock_count', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `PC-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, id: string): Promise<CountWithItems> {
    const count = await this.prisma.stockCount.findFirst({
      where: { id, organizationId },
      include: {
        warehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
    });
    if (!count) throw new NotFoundException('Stock count not found');
    return count;
  }

  private toResponse(c: CountWithItems, user: RequestUser): CountResponse {
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const canVal = user.permissions.includes(PERMISSIONS.VALUATION_VIEW);
    // Blind counts hide expected qty and variance until the count leaves COUNTING.
    const hideSystem = c.isBlind && c.status === CountStatus.COUNTING;

    let varianceValue = new Prisma.Decimal(0);
    const items = c.items.map((i) => {
      const counted = i.countedQty;
      const variance = counted !== null ? new Prisma.Decimal(counted).sub(i.systemQty) : null;
      if (variance) varianceValue = varianceValue.add(variance.mul(i.unitCost));
      const item: CountResponse['items'][number] = {
        id: i.id,
        productId: i.productId,
        productSku: i.product.sku,
        productName: i.product.name,
        variantId: i.variantId,
        lotId: i.lotId ?? null,
        countedQty: counted !== null ? counted.toString() : null,
        recountQty: i.recountQty !== null ? i.recountQty.toString() : null,
        remarks: i.remarks,
      };
      if (!hideSystem) {
        item.systemQty = i.systemQty.toString();
        if (variance) item.varianceQty = variance.toString();
      }
      if (canCost) item.unitCost = i.unitCost.toString();
      return item;
    });

    const res: CountResponse = {
      id: c.id,
      countNumber: c.countNumber,
      warehouseId: c.warehouseId,
      warehouseCode: c.warehouse.code,
      type: c.type as CountType,
      isBlind: c.isBlind,
      status: c.status,
      snapshotAt: c.snapshotAt.toISOString(),
      notes: c.notes,
      requestorId: c.requestorId,
      approvedById: c.approvedById,
      postedAt: c.postedAt ? c.postedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      cycleCountTaskId: c.cycleCountTaskId,
      items,
    };
    if (canVal && !hideSystem) res.varianceValue = varianceValue.toDecimalPlaces(4).toString();
    return res;
  }
}
