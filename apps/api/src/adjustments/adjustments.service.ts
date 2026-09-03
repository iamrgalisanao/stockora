import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AdjustmentStatus, MovementType, SerialStatus } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { AdjustmentListItem, AdjustmentResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { SerialsService } from '../serials/serials.service';
import { NIL_UUID, ZERO } from '../inventory/inventory.constants';
import {
  AdjustmentItemInputDto,
  CreateAdjustmentDto,
  RejectAdjustmentDto,
  UpdateAdjustmentDto,
} from './dto/adjustment.dto';

const DEFAULT_HIGH_VALUE_THRESHOLD = 10000;

type AdjustmentWithItems = Prisma.StockAdjustmentGetPayload<{
  include: {
    warehouse: { select: { code: true } };
    reason: { select: { name: true } };
    items: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly posting: InventoryPostingService,
    private readonly serials: SerialsService,
  ) {}

  async list(organizationId: string, user: RequestUser): Promise<AdjustmentListItem[]> {
    const scope = user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;
    const rows = await this.prisma.stockAdjustment.findMany({
      where: { organizationId, ...(scope ? { warehouseId: scope } : {}) },
      include: {
        warehouse: { select: { code: true } },
        reason: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => ({
      id: a.id,
      adjustmentNumber: a.adjustmentNumber,
      warehouseCode: a.warehouse.code,
      reasonName: a.reason?.name ?? null,
      status: a.status,
      requiresSecondApproval: a.requiresSecondApproval,
      createdAt: a.createdAt.toISOString(),
      lineCount: a._count.items,
    }));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    return this.toResponse(adj, user);
  }

  async create(
    organizationId: string,
    user: RequestUser,
    dto: CreateAdjustmentDto,
  ): Promise<AdjustmentResponse> {
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);
    await this.ensureProducts(organizationId, dto.items);
    if (dto.reasonId) await this.ensureReason(organizationId, dto.reasonId);

    const adjustmentNumber = await this.nextNumber(organizationId);
    const adj = await this.prisma.stockAdjustment.create({
      data: {
        organizationId,
        adjustmentNumber,
        warehouseId: dto.warehouseId,
        reasonId: dto.reasonId ?? null,
        requestorId: user.userId,
        notes: dto.notes ?? null,
        items: { create: dto.items.map((i) => this.toItemData(organizationId, i)) },
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_adjustment.created',
      entityType: 'stock_adjustment',
      entityId: adj.id,
      newValue: { adjustmentNumber, warehouseId: dto.warehouseId, lines: dto.items.length },
    });
    return this.get(organizationId, user, adj.id);
  }

  async update(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: UpdateAdjustmentDto,
  ): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    this.assertStatus(adj, [AdjustmentStatus.DRAFT], 'edited');
    if (dto.items) await this.ensureProducts(organizationId, dto.items);
    if (dto.reasonId) await this.ensureReason(organizationId, dto.reasonId);

    await this.prisma.$transaction(async (tx) => {
      await tx.stockAdjustment.update({
        where: { id },
        data: {
          ...(dto.reasonId !== undefined ? { reasonId: dto.reasonId } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      if (dto.items) {
        await tx.stockAdjustmentItem.deleteMany({ where: { adjustmentId: id } });
        await tx.stockAdjustmentItem.createMany({
          data: dto.items.map((i) => ({ adjustmentId: id, ...this.toItemData(organizationId, i) })),
        });
      }
    });
    return this.get(organizationId, user, id);
  }

  /** Submit for approval — computes the cost impact and whether a second approver is required. */
  async submit(organizationId: string, user: RequestUser, id: string): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    this.assertStatus(adj, [AdjustmentStatus.DRAFT], 'submitted');

    const estimatedValue = await this.computeEstimatedValue(organizationId, adj);
    const threshold = await this.highValueThreshold(organizationId);
    const requiresSecondApproval = estimatedValue.gt(threshold);

    await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: AdjustmentStatus.SUBMITTED, estimatedValue, requiresSecondApproval },
    });
    return this.get(organizationId, user, id);
  }

  async approve(organizationId: string, user: RequestUser, id: string): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    this.assertStatus(adj, [AdjustmentStatus.SUBMITTED], 'approved');

    const next = adj.requiresSecondApproval
      ? AdjustmentStatus.PENDING_SECOND_APPROVAL
      : AdjustmentStatus.APPROVED;
    await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: next, firstApprovedById: user.userId },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_adjustment.first_approved',
      entityType: 'stock_adjustment',
      entityId: id,
      newValue: { next },
    });
    return this.get(organizationId, user, id);
  }

  /** Second approval for high-value adjustments — must be a different approver. */
  async secondApprove(organizationId: string, user: RequestUser, id: string): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    this.assertStatus(adj, [AdjustmentStatus.PENDING_SECOND_APPROVAL], 'second-approved');
    if (adj.firstApprovedById && adj.firstApprovedById === user.userId) {
      throw new BadRequestException('The second approver must be different from the first approver');
    }
    await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: AdjustmentStatus.APPROVED, secondApprovedById: user.userId },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_adjustment.second_approved',
      entityType: 'stock_adjustment',
      entityId: id,
    });
    return this.get(organizationId, user, id);
  }

  async reject(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: RejectAdjustmentDto,
  ): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    this.assertStatus(adj, [AdjustmentStatus.SUBMITTED, AdjustmentStatus.PENDING_SECOND_APPROVAL], 'rejected');
    await this.prisma.stockAdjustment.update({
      where: { id },
      data: { status: AdjustmentStatus.REJECTED, notes: dto.reason },
    });
    return this.get(organizationId, user, id);
  }

  /** Posts approved adjustment lines to the ledger (ADJUSTMENT_IN / ADJUSTMENT_OUT). */
  async post(
    organizationId: string,
    user: RequestUser,
    id: string,
    idempotencyKey?: string,
  ): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    if (adj.status === AdjustmentStatus.POSTED) return this.toResponse(adj, user);
    this.assertStatus(adj, [AdjustmentStatus.APPROVED], 'posted');

    // Resolve serialization per product and validate every serialized line BEFORE posting (ADR 0012 §9):
    // an OUT line removes exactly `quantity` existing IN_STOCK serials (→ DISPOSED or DAMAGED); an IN line
    // registers exactly `quantity` NEW serials (→ IN_STOCK). Never an anonymous ±N for a serialized product.
    const plans = new Map<string, { serialized: boolean; numbers: string[] }>();
    const seen = new Set<string>();
    for (const i of adj.items) {
      const meta = await this.serials.serialMetaFor(organizationId, i.productId);
      const variantKey = i.variantId ?? NIL_UUID;
      if (!meta.isSerialized) {
        if (i.serialNumbers.length > 0) throw new BadRequestException('A non-serialized product cannot carry serial numbers');
        plans.set(i.id, { serialized: false, numbers: [] });
        continue;
      }
      const q = new Prisma.Decimal(i.quantity);
      if (!q.isInteger()) throw new BadRequestException('A serialized product must be adjusted in whole units');
      const numbers = this.serials.normalize(i.serialNumbers, i.productId);
      if (numbers.length !== q.toNumber()) throw new BadRequestException(`A serialized ${i.direction} line needs exactly ${q.toString()} serial(s), got ${numbers.length}`);
      for (const sn of numbers) { const k = `${i.productId}::${variantKey}::${sn}`; if (seen.has(k)) throw new BadRequestException(`Serial ${sn} appears on more than one line`); seen.add(k); }
      if (i.direction === 'OUT') {
        const rows = await this.prisma.inventorySerial.findMany({ where: { organizationId, productId: i.productId, variantId: variantKey, serialNumber: { in: numbers } } });
        const byNum = new Map(rows.map((r) => [r.serialNumber, r]));
        for (const sn of numbers) {
          const r = byNum.get(sn);
          if (!r) throw new BadRequestException(`Serial ${sn} is not registered for this product`);
          if (r.status !== 'IN_STOCK') throw new BadRequestException(`Serial ${sn} is ${r.status} and cannot be adjusted out`);
          if (r.currentWarehouseId !== adj.warehouseId) throw new BadRequestException(`Serial ${sn} is not in this warehouse`);
          if (i.lotId && r.lotId !== i.lotId) throw new BadRequestException(`Serial ${sn} does not belong to the line lot`);
        }
      } else {
        const clash = await this.prisma.inventorySerial.findFirst({ where: { organizationId, productId: i.productId, variantId: variantKey, serialNumber: { in: numbers } }, select: { serialNumber: true } });
        if (clash) throw new BadRequestException(`Serial ${clash.serialNumber} is already registered for this product`);
      }
      plans.set(i.id, { serialized: true, numbers });
    }

    // Lot flows through to the posting layer (ADR 0007). Everything posts + transitions in ONE transaction
    // so the ledger and the serial registry commit together (a DAMAGED serial rides an on_hand→damaged move).
    const key = idempotencyKey ?? `stock_adjustment:${adj.id}`;
    let firstKeyUsed = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const i of adj.items) {
          const plan = plans.get(i.id)!;
          const variantKey = i.variantId ?? NIL_UUID;
          const q = new Prisma.Decimal(i.quantity);
          const damaged = i.direction === 'OUT' && plan.serialized && i.serialDisposition === 'DAMAGED';
          const movementType = i.direction === 'IN'
            ? MovementType.STOCK_ADJUSTMENT_IN
            : damaged ? MovementType.DAMAGE : MovementType.STOCK_ADJUSTMENT_OUT;
          const movement = await this.posting.postLineInTx(
            tx,
            { organizationId, actorId: user.userId, idempotencyKey: firstKeyUsed ? null : key },
            {
              movementType,
              warehouseId: adj.warehouseId,
              referenceType: 'stock_adjustment',
              referenceId: adj.id,
              line: {
                productId: i.productId, variantId: i.variantId, quantity: q,
                unitCost: i.direction === 'IN' ? i.unitCost : null, locationId: i.locationId, lotId: i.lotId,
                // DAMAGE from stock: on_hand → damaged (default OUT would only drop on_hand).
                ...(damaged ? { deltas: { onHand: q.neg(), reserved: ZERO, inTransit: ZERO, quarantined: ZERO, damaged: q } } : {}),
              },
            },
          );
          firstKeyUsed = true;
          if (plan.serialized) {
            if (i.direction === 'IN') {
              await this.serials.createSerialsInTx(tx, organizationId, {
                productId: i.productId, variantKey, lotId: i.lotId, serialNumbers: plan.numbers,
                status: SerialStatus.IN_STOCK, warehouseId: adj.warehouseId, locationId: i.locationId, movementId: movement.id, received: true,
              });
            } else {
              await this.serials.transitionExistingInTx(tx, organizationId, {
                productId: i.productId, variantKey, serialNumbers: plan.numbers,
                expectFrom: [SerialStatus.IN_STOCK], to: damaged ? SerialStatus.DAMAGED : SerialStatus.DISPOSED,
                requireWarehouseId: adj.warehouseId, movementId: movement.id,
              });
            }
          }
        }
        await tx.stockAdjustment.update({ where: { id }, data: { status: AdjustmentStatus.POSTED, postedAt: new Date() } });
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        const already = await this.load(organizationId, id);
        if (already.status === AdjustmentStatus.POSTED) return this.toResponse(already, user);
      }
      throw e;
    }
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_adjustment.posted',
      entityType: 'stock_adjustment',
      entityId: id,
      newValue: { lines: adj.items.length },
    });
    return this.get(organizationId, user, id);
  }

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<AdjustmentResponse> {
    const adj = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, adj.warehouseId);
    if (adj.status === AdjustmentStatus.POSTED) {
      throw new BadRequestException('A posted adjustment cannot be cancelled; reverse its movements instead');
    }
    await this.prisma.stockAdjustment.update({ where: { id }, data: { status: AdjustmentStatus.CANCELLED } });
    return this.get(organizationId, user, id);
  }

  // ---- helpers ----

  private async computeEstimatedValue(organizationId: string, adj: AdjustmentWithItems): Promise<Prisma.Decimal> {
    let total = new Prisma.Decimal(0);
    for (const item of adj.items) {
      const q = new Prisma.Decimal(item.quantity);
      let unit: Prisma.Decimal;
      if (item.direction === 'IN') {
        unit = new Prisma.Decimal(item.unitCost);
      } else {
        // OUT valued at current average cost at this (product, warehouse).
        const bal = await this.prisma.inventoryBalance.findFirst({
          where: {
            organizationId,
            productId: item.productId,
            variantId: item.variantId ?? NIL_UUID,
            warehouseId: adj.warehouseId,
          },
          select: { avgCost: true },
        });
        unit = new Prisma.Decimal(bal?.avgCost ?? 0);
      }
      total = total.add(q.mul(unit));
    }
    return total.toDecimalPlaces(4);
  }

  private async highValueThreshold(organizationId: string): Promise<number> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const raw = settings.highValueAdjustmentThreshold;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_HIGH_VALUE_THRESHOLD;
  }

  private toItemData(organizationId: string, i: AdjustmentItemInputDto) {
    return {
      organizationId,
      productId: i.productId,
      variantId: i.variantId ?? null,
      direction: i.direction,
      quantity: i.quantity,
      unitCost: i.unitCost ?? 0,
      locationId: i.locationId ?? null,
      lotId: i.lotId ?? null,
      serialNumbers: i.serialNumbers ?? [],
      serialDisposition: i.direction === 'OUT' ? i.serialDisposition ?? null : null,
      remarks: i.remarks ?? null,
    };
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private assertStatus(adj: AdjustmentWithItems, allowed: AdjustmentStatus[], verb: string): void {
    if (!allowed.includes(adj.status)) {
      throw new BadRequestException(`A ${adj.status} adjustment cannot be ${verb}`);
    }
  }

  private async ensureProducts(organizationId: string, items: AdjustmentItemInputDto[]): Promise<void> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const found = await this.prisma.product.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) throw new BadRequestException('One or more products not found');
  }

  private async ensureReason(organizationId: string, reasonId: string): Promise<void> {
    const r = await this.prisma.adjustmentReason.findFirst({ where: { id: reasonId, organizationId } });
    if (!r) throw new BadRequestException('Adjustment reason not found');
  }

  private async nextNumber(organizationId: string): Promise<string> {
    const seq = await this.prisma.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'stock_adjustment' } },
      create: { organizationId, key: 'stock_adjustment', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `ADJ-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, id: string): Promise<AdjustmentWithItems> {
    const adj = await this.prisma.stockAdjustment.findFirst({
      where: { id, organizationId },
      include: {
        warehouse: { select: { code: true } },
        reason: { select: { name: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
    });
    if (!adj) throw new NotFoundException('Stock adjustment not found');
    return adj;
  }

  private toResponse(a: AdjustmentWithItems, user: RequestUser): AdjustmentResponse {
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const canVal = user.permissions.includes(PERMISSIONS.VALUATION_VIEW);
    const res: AdjustmentResponse = {
      id: a.id,
      adjustmentNumber: a.adjustmentNumber,
      warehouseId: a.warehouseId,
      warehouseCode: a.warehouse.code,
      reasonId: a.reasonId,
      reasonName: a.reason?.name ?? null,
      status: a.status,
      requiresSecondApproval: a.requiresSecondApproval,
      requestorId: a.requestorId,
      firstApprovedById: a.firstApprovedById,
      secondApprovedById: a.secondApprovedById,
      notes: a.notes,
      postedAt: a.postedAt ? a.postedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
      items: a.items.map((i) => {
        const item: AdjustmentResponse['items'][number] = {
          id: i.id,
          productId: i.productId,
          productSku: i.product.sku,
          productName: i.product.name,
          variantId: i.variantId,
          direction: i.direction,
          quantity: i.quantity.toString(),
          remarks: i.remarks,
        };
        if (canCost) item.unitCost = i.unitCost.toString();
        return item;
      }),
    };
    if (canVal) res.estimatedValue = a.estimatedValue.toString();
    return res;
  }
}
