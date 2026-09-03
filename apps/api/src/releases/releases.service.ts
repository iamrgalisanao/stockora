import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReleaseStatus } from '@prisma/client';
import { PERMISSIONS, type ReleaseListItem, type ReleaseResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService, type StockLine } from '../inventory/inventory-posting.service';
import { ReservationsService } from '../reservations/reservations.service';
import { LotsService } from '../lots/lots.service';
import { NIL_UUID } from '../inventory/inventory.constants';
import { DEFAULT_BUSINESS_TZ, isExpired } from '../common/business-date';
import {
  ApproveReleaseDto,
  CreateReleaseDto,
  ReleaseItemInputDto,
  RejectReleaseDto,
  UpdateReleaseDto,
} from './dto/release.dto';

type ReleaseWithItems = Prisma.StockReleaseGetPayload<{
  include: {
    warehouse: { select: { code: true } };
    items: { include: { product: { select: { sku: true; name: true; isBatchTracked: true } }; allocations: true } };
  };
}>;

@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly posting: InventoryPostingService,
    private readonly reservations: ReservationsService,
    private readonly lots: LotsService,
  ) {}

  /** Order-insensitive per-lot equality of two allocation sets (normalizes split entries by summing). */
  private allocationsMatch(
    submitted: Array<{ lotId: string; quantity: Prisma.Decimal }>,
    canonical: Array<{ lotId: string; quantity: string }>,
  ): boolean {
    const norm = (pairs: Array<[string, Prisma.Decimal]>) => {
      const m = new Map<string, Prisma.Decimal>();
      for (const [lotId, q] of pairs) m.set(lotId, (m.get(lotId) ?? new Prisma.Decimal(0)).add(q));
      return m;
    };
    const a = norm(submitted.map((s) => [s.lotId, new Prisma.Decimal(s.quantity)]));
    const b = norm(canonical.map((c) => [c.lotId, new Prisma.Decimal(c.quantity)]));
    if (a.size !== b.size) return false;
    for (const [lotId, q] of a) { const bv = b.get(lotId); if (!bv || !bv.equals(q)) return false; }
    return true;
  }

  async list(organizationId: string, user: RequestUser): Promise<ReleaseListItem[]> {
    const scope = user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;
    const rows = await this.prisma.stockRelease.findMany({
      where: { organizationId, ...(scope ? { warehouseId: scope } : {}) },
      include: { warehouse: { select: { code: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      releaseNumber: r.releaseNumber,
      warehouseCode: r.warehouse.code,
      destinationType: r.destinationType as ReleaseListItem['destinationType'],
      purpose: r.purpose,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      lineCount: r._count.items,
    }));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    return this.toResponse(release);
  }

  async create(
    organizationId: string,
    user: RequestUser,
    dto: CreateReleaseDto,
  ): Promise<ReleaseResponse> {
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);
    await this.ensureProducts(organizationId, dto.items);

    const releaseNumber = await this.nextNumber(organizationId);
    const release = await this.prisma.stockRelease.create({
      data: {
        organizationId,
        releaseNumber,
        warehouseId: dto.warehouseId,
        purpose: dto.purpose ?? null,
        destinationType: dto.destinationType,
        destinationRef: dto.destinationRef ?? null,
        reference: dto.reference ?? null,
        requestorId: user.userId,
        notes: dto.notes ?? null,
        items: {
          create: dto.items.map((i) => ({
            organizationId,
            productId: i.productId,
            variantId: i.variantId ?? null,
            requestedQty: i.requestedQty,
            locationId: i.locationId ?? null,
            reservationLineId: i.reservationLineId ?? null,
            remarks: i.remarks ?? null,
            ...(i.allocations && i.allocations.length > 0
              ? { allocations: { create: i.allocations.map((a) => ({ organizationId, lotId: a.lotId, quantity: a.quantity })) } }
              : {}),
          })),
        },
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_release.created',
      entityType: 'stock_release',
      entityId: release.id,
      newValue: { releaseNumber, warehouseId: dto.warehouseId, lines: dto.items.length },
    });
    return this.get(organizationId, user, release.id);
  }

  async update(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: UpdateReleaseDto,
  ): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    this.assertStatus(release, [ReleaseStatus.DRAFT], 'edited');
    if (dto.items) await this.ensureProducts(organizationId, dto.items);

    await this.prisma.$transaction(async (tx) => {
      await tx.stockRelease.update({
        where: { id },
        data: {
          ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
          ...(dto.destinationType !== undefined ? { destinationType: dto.destinationType } : {}),
          ...(dto.destinationRef !== undefined ? { destinationRef: dto.destinationRef } : {}),
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      if (dto.items) {
        await tx.stockReleaseItem.deleteMany({ where: { releaseId: id } });
        await tx.stockReleaseItem.createMany({
          data: dto.items.map((i) => ({
            releaseId: id,
            organizationId,
            productId: i.productId,
            variantId: i.variantId ?? null,
            requestedQty: i.requestedQty,
            locationId: i.locationId ?? null,
            remarks: i.remarks ?? null,
          })),
        });
      }
    });
    return this.get(organizationId, user, id);
  }

  async submit(organizationId: string, user: RequestUser, id: string): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    this.assertStatus(release, [ReleaseStatus.DRAFT], 'submitted');
    await this.prisma.stockRelease.update({ where: { id }, data: { status: ReleaseStatus.FOR_APPROVAL } });
    return this.get(organizationId, user, id);
  }

  async approve(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: ApproveReleaseDto,
  ): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    this.assertStatus(release, [ReleaseStatus.FOR_APPROVAL], 'approved');

    const overrides = new Map((dto.items ?? []).map((i) => [i.itemId, i.approvedQty]));
    for (const item of release.items) {
      const requested = new Prisma.Decimal(item.requestedQty);
      const approved = overrides.has(item.id)
        ? new Prisma.Decimal(overrides.get(item.id)!)
        : requested;
      if (approved.gt(requested)) {
        throw new BadRequestException('Approved quantity cannot exceed the requested quantity');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of release.items) {
        const approved = overrides.has(item.id) ? overrides.get(item.id)! : item.requestedQty;
        await tx.stockReleaseItem.update({ where: { id: item.id }, data: { approvedQty: approved } });
      }
      await tx.stockRelease.update({
        where: { id },
        data: { status: ReleaseStatus.APPROVED, approvedById: user.userId },
      });
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_release.approved',
      entityType: 'stock_release',
      entityId: id,
    });
    return this.get(organizationId, user, id);
  }

  async reject(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: RejectReleaseDto,
  ): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    this.assertStatus(release, [ReleaseStatus.FOR_APPROVAL], 'rejected');
    await this.prisma.stockRelease.update({
      where: { id },
      data: { status: ReleaseStatus.REJECTED, notes: dto.reason },
    });
    return this.get(organizationId, user, id);
  }

  /** Posts the approved quantities to the ledger (SALES_RELEASE) and closes the release. */
  async post(
    organizationId: string,
    user: RequestUser,
    id: string,
    idempotencyKey?: string,
    fefoOverrideReason?: string,
  ): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    if (release.status === ReleaseStatus.RELEASED) return this.toResponse(release);
    // Approval is mandatory before posting (product decision).
    this.assertStatus(release, [ReleaseStatus.APPROVED], 'released');

    const approved = release.items.filter((i) => new Prisma.Decimal(i.approvedQty).gt(0));
    if (approved.length === 0) throw new BadRequestException('No approved quantities to release');

    // Validate every reservation-backed line up front (clean error before any posting).
    for (const i of approved) {
      if (i.reservationLineId) {
        await this.reservations.validateConsumable(
          organizationId, i.reservationLineId, release.warehouseId, i.productId, i.variantId ?? NIL_UUID,
          new Prisma.Decimal(i.approvedQty),
        );
      }
    }

    // Resolve the effective lot allocations per batch line (ADR 0007 seam + ADR 0008 FEFO). A batch line's
    // allocations are either operator-submitted (MANUAL, or a reviewed FEFO plan) or, under a FEFO policy
    // with none submitted, generated deterministically here. A submitted plan that materially bypasses an
    // earlier-expiring eligible lot requires inventory.fefo_override + a reason, and is audited.
    const ZERO = new Prisma.Decimal(0);
    const effective = new Map<string, Array<{ lotId: string; quantity: Prisma.Decimal }>>();
    for (const i of approved) {
      const q = new Prisma.Decimal(i.approvedQty);
      if (!i.product.isBatchTracked) {
        if (i.allocations.length > 0) throw new BadRequestException(`Line for ${i.product.sku} is not batch-tracked and cannot carry lot allocations`);
        continue;
      }
      const strategy = await this.lots.allocationStrategyFor(organizationId, i.productId, i.variantId ?? NIL_UUID);
      if (i.allocations.length === 0) {
        if (strategy !== 'FEFO') throw new BadRequestException(`Line for ${i.product.sku} is batch-tracked and requires lot allocations`);
        const plan = await this.lots.fefoPlan(organizationId, user, i.productId, i.variantId ?? NIL_UUID, release.warehouseId, q);
        if (!plan.complete) throw new BadRequestException(`Insufficient eligible (non-expired) stock to FEFO-allocate ${i.product.sku}`);
        effective.set(i.id, plan.allocations.map((a) => ({ lotId: a.lotId, quantity: new Prisma.Decimal(a.quantity) })));
      } else {
        const allocSum = i.allocations.reduce((a, al) => a.add(al.quantity), ZERO);
        if (!allocSum.equals(q)) throw new BadRequestException(`Lot allocations for ${i.product.sku} must sum to the approved quantity`);
        // Revalidate the submitted plan is still postable (ADR 0008 §7). A plan gone stale since preview
        // (a chosen lot drained by another release) is a conflict — never silently reallocated.
        const subBalances = await this.prisma.inventoryBalance.findMany({
          where: { organizationId, warehouseId: release.warehouseId, productId: i.productId, variantId: i.variantId ?? NIL_UUID, lotId: { in: i.allocations.map((a) => a.lotId) } },
        });
        const availByLot = new Map(subBalances.map((b) => [b.lotId, b.onHand.sub(b.reserved).sub(b.quarantined)]));
        for (const al of i.allocations) {
          if (new Prisma.Decimal(al.quantity).gt(availByLot.get(al.lotId) ?? ZERO)) {
            throw new ConflictException(`Allocation for ${i.product.sku} is stale — a selected lot no longer has enough available; refresh the plan`);
          }
        }
        if (strategy === 'FEFO') {
          const canonical = await this.lots.fefoPlan(organizationId, user, i.productId, i.variantId ?? NIL_UUID, release.warehouseId, q);
          if (!this.allocationsMatch(i.allocations, canonical.allocations)) {
            // Material deviation from FEFO — requires explicit authorized justification (ADR 0008 §6).
            if (!user.permissions.includes(PERMISSIONS.INVENTORY_FEFO_OVERRIDE)) {
              throw new ForbiddenException(`Releasing ${i.product.sku} against a non-FEFO lot selection requires inventory.fefo_override`);
            }
            if (!fefoOverrideReason || !fefoOverrideReason.trim()) {
              throw new BadRequestException('A reason is required to override FEFO allocation');
            }
            await this.audit.record({
              organizationId, userId: user.userId, action: 'release.fefo_override', entityType: 'stock_release',
              entityId: id, entityDisplay: release.releaseNumber, warehouseId: release.warehouseId,
              newValue: {
                productId: i.productId, requestedQuantity: q.toString(), reason: fefoOverrideReason,
                recommended: canonical.allocations.map((a) => ({ lotId: a.lotId, quantity: a.quantity })),
                submitted: i.allocations.map((a) => ({ lotId: a.lotId, quantity: a.quantity.toString() })),
              },
            });
          }
        }
        effective.set(i.id, i.allocations.map((a) => ({ lotId: a.lotId, quantity: new Prisma.Decimal(a.quantity) })));
      }
    }

    // Expired lots cannot enter normal outbound allocation (ADR 0008 §2). Physical stock is untouched.
    const allocLotIds = [...new Set([...effective.values()].flat().map((a) => a.lotId))];
    if (allocLotIds.length > 0) {
      const allocLots = await this.prisma.inventoryLot.findMany({
        where: { organizationId, id: { in: allocLotIds } }, select: { id: true, lotNumber: true, expiryDate: true },
      });
      for (const lot of allocLots) {
        if (isExpired(lot.expiryDate, DEFAULT_BUSINESS_TZ)) {
          throw new BadRequestException(`Lot ${lot.lotNumber} is expired and cannot be released`);
        }
      }
    }

    // Build posting lines. Non-batch: one SALES_RELEASE per item (on_hand −q, and reserved −q on the same
    // NIL row when reservation-backed). Batch: one SALES_RELEASE per effective allocation (on_hand −q at the
    // lot); the reservation's `reserved` bucket lives on the NIL row and is decremented directly below.
    const lines: StockLine[] = [];
    for (const i of approved) {
      const q = new Prisma.Decimal(i.approvedQty);
      if (i.product.isBatchTracked) {
        for (const al of effective.get(i.id) ?? []) {
          lines.push({
            productId: i.productId, variantId: i.variantId, quantity: al.quantity, locationId: i.locationId, lotId: al.lotId,
            deltas: { onHand: al.quantity.neg(), reserved: ZERO, inTransit: ZERO, quarantined: ZERO, damaged: ZERO },
          });
        }
      } else {
        lines.push({
          productId: i.productId, variantId: i.variantId, quantity: i.approvedQty, locationId: i.locationId,
          ...(i.reservationLineId
            ? { deltas: { onHand: q.neg(), reserved: q.neg(), inTransit: ZERO, quarantined: ZERO, damaged: ZERO } }
            : {}),
        });
      }
    }

    await this.posting.release(
      {
        organizationId,
        actorId: user.userId,
        idempotencyKey: idempotencyKey ?? `stock_release:${release.id}`,
      },
      { warehouseId: release.warehouseId, referenceType: 'stock_release', referenceId: release.id, lines },
    );

    const consumed = await this.prisma.$transaction(async (tx) => {
      const results: Array<{ reservationId: string; reservationNo: string; status: string }> = [];
      for (const item of release.items) {
        const q = new Prisma.Decimal(item.approvedQty);
        await tx.stockReleaseItem.update({ where: { id: item.id }, data: { releasedQty: item.approvedQty } });
        if (item.reservationLineId && q.gt(0)) {
          // A batch reservation's `reserved` sits on the NIL-lot row (the reservation was lot-agnostic);
          // consuming it decrements that bucket directly, since the physical movement hit the lot rows.
          if (item.product.isBatchTracked) {
            await tx.$executeRaw`
              UPDATE inventory_balances SET reserved = reserved - ${q}, version = version + 1
              WHERE organization_id = ${organizationId}::uuid AND product_id = ${item.productId}::uuid
                AND variant_id = ${item.variantId ?? NIL_UUID}::uuid AND warehouse_id = ${release.warehouseId}::uuid
                AND lot_id = ${NIL_UUID}::uuid`;
          }
          results.push(await this.reservations.recordConsumption(tx, item.reservationLineId, q));
        }
      }
      await tx.stockRelease.update({
        where: { id },
        data: { status: ReleaseStatus.RELEASED, releasedById: user.userId, postedAt: new Date() },
      });
      return results;
    });

    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_release.posted',
      entityType: 'stock_release',
      entityId: id,
      newValue: { lines: lines.length, reservationsConsumed: consumed.length },
    });
    // A consumed reservation's own history records the consumption + resulting status.
    for (const c of consumed) {
      await this.audit.record({
        organizationId, userId: user.userId, action: 'reservation.consumed', entityType: 'reservation',
        entityId: c.reservationId, entityDisplay: c.reservationNo, warehouseId: release.warehouseId,
        reference: release.releaseNumber, newValue: { status: c.status },
      });
    }
    return this.get(organizationId, user, id);
  }

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    if (release.status === ReleaseStatus.RELEASED) {
      throw new BadRequestException('A released document cannot be cancelled; reverse its movements instead');
    }
    await this.prisma.stockRelease.update({ where: { id }, data: { status: ReleaseStatus.CANCELLED } });
    return this.get(organizationId, user, id);
  }

  // ---- helpers ----

  private assertStatus(release: ReleaseWithItems, allowed: ReleaseStatus[], verb: string): void {
    if (!allowed.includes(release.status)) {
      throw new BadRequestException(`A ${release.status} release cannot be ${verb}`);
    }
  }

  private async ensureProducts(organizationId: string, items: ReleaseItemInputDto[]): Promise<void> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const found = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new BadRequestException('One or more products not found');
  }

  private async nextNumber(organizationId: string): Promise<string> {
    const seq = await this.prisma.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'stock_release' } },
      create: { organizationId, key: 'stock_release', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `RL-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, id: string): Promise<ReleaseWithItems> {
    const release = await this.prisma.stockRelease.findFirst({
      where: { id, organizationId },
      include: {
        warehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true, isBatchTracked: true } }, allocations: true } },
      },
    });
    if (!release) throw new NotFoundException('Stock release not found');
    return release;
  }

  private toResponse(r: ReleaseWithItems): ReleaseResponse {
    return {
      id: r.id,
      releaseNumber: r.releaseNumber,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      purpose: r.purpose,
      destinationType: r.destinationType as ReleaseResponse['destinationType'],
      destinationRef: r.destinationRef,
      reference: r.reference,
      status: r.status,
      requestorId: r.requestorId,
      approvedById: r.approvedById,
      notes: r.notes,
      postedAt: r.postedAt ? r.postedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productSku: i.product.sku,
        productName: i.product.name,
        variantId: i.variantId,
        requestedQty: i.requestedQty.toString(),
        approvedQty: i.approvedQty.toString(),
        releasedQty: i.releasedQty.toString(),
        locationId: i.locationId,
        reservationLineId: i.reservationLineId,
        remarks: i.remarks,
      })),
    };
  }
}
