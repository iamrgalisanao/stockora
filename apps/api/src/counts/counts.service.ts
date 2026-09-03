import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, CountStatus, CountType } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { CountListItem, CountResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
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
  ) {}

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
        items: {
          create: snapshot.map((s) => ({
            organizationId,
            productId: s.productId,
            variantId: s.variantId,
            lotId: s.lotId,
            systemQty: s.systemQty,
            unitCost: s.unitCost,
          })),
        },
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
    await this.prisma.$transaction(
      dto.items.map((entry) =>
        this.prisma.stockCountItem.update({ where: { id: entry.itemId }, data: { countedQty: entry.countedQty } }),
      ),
    );
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

    const inLines: Array<{ productId: string; variantId: string | null; quantity: string; unitCost: string; lotId: string | null }> = [];
    const outLines: Array<{ productId: string; variantId: string | null; quantity: string; lotId: string | null }> = [];
    for (const item of count.items) {
      const counted = item.countedQty ?? item.systemQty;
      const variance = new Prisma.Decimal(counted).sub(item.systemQty);
      if (variance.gt(0)) {
        inLines.push({ productId: item.productId, variantId: item.variantId, quantity: variance.toString(), unitCost: item.unitCost.toString(), lotId: item.lotId });
      } else if (variance.lt(0)) {
        outLines.push({ productId: item.productId, variantId: item.variantId, quantity: variance.abs().toString(), lotId: item.lotId });
      }
    }

    const base = idempotencyKey ?? `physical_count:${count.id}`;
    if (inLines.length > 0) {
      await this.posting.adjustment(
        { organizationId, actorId: user.userId, idempotencyKey: `${base}:IN` },
        { warehouseId: count.warehouseId, direction: 'IN', referenceId: count.id, lines: inLines },
      );
    }
    if (outLines.length > 0) {
      await this.posting.adjustment(
        { organizationId, actorId: user.userId, idempotencyKey: `${base}:OUT` },
        { warehouseId: count.warehouseId, direction: 'OUT', referenceId: count.id, lines: outLines },
      );
    }

    await this.prisma.stockCount.update({ where: { id }, data: { status: CountStatus.POSTED, postedAt: new Date() } });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_count.posted',
      entityType: 'stock_count',
      entityId: id,
      newValue: { in: inLines.length, out: outLines.length },
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
      items,
    };
    if (canVal && !hideSystem) res.varianceValue = varianceValue.toDecimalPlaces(4).toString();
    return res;
  }
}
