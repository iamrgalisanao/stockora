import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, ReservationStatus } from '@prisma/client';
import { RESERVATION_EXPIRING_SOON_HOURS, type ReservationResponse, type ReservedBreakdownRow } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { isWarehouseAllowed } from '../common/warehouse-scope';
import { D, NIL_UUID } from '../inventory/inventory.constants';
import { CreateReservationDto } from './dto/reservation.dto';

export interface ReservationListFilter {
  status?: ReservationStatus;
  warehouseId?: string;
  sourceType?: string;
  q?: string; // reservation number or product sku
  expiringSoon?: boolean;
  from?: string;
  to?: string;
}

type Tx = Prisma.TransactionClient;

type ReservationRow = Prisma.InventoryReservationGetPayload<{
  include: {
    warehouse: { select: { code: true } };
    lines: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

const RESERVATION_INCLUDE = {
  warehouse: { select: { code: true } },
  lines: { include: { product: { select: { sku: true, name: true } } } },
} as const;

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- reads ----

  async list(organizationId: string, user: RequestUser, filter: ReservationListFilter = {}): Promise<ReservationResponse[]> {
    const scope = user.warehouseScope;
    const soonCutoff = new Date(Date.now() + RESERVATION_EXPIRING_SOON_HOURS * 3600_000);
    const rows = await this.prisma.inventoryReservation.findMany({
      where: {
        organizationId,
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.sourceType ? { sourceType: filter.sourceType as never } : {}),
        ...(filter.from || filter.to
          ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } }
          : {}),
        ...(filter.expiringSoon
          ? { status: { in: ['RESERVED', 'PARTIALLY_CONSUMED'] }, expiresAt: { not: null, lte: soonCutoff } }
          : {}),
        ...(filter.q
          ? {
              OR: [
                { reservationNo: { contains: filter.q, mode: 'insensitive' } },
                { lines: { some: { product: { sku: { contains: filter.q, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
      include: RESERVATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toResponse(r));
  }

  /** The active reservation lines composing a balance's `reserved` bucket (stock drill-down). */
  async reservedBreakdown(
    organizationId: string,
    user: RequestUser,
    productId: string,
    warehouseId: string,
    variantId?: string,
  ): Promise<ReservedBreakdownRow[]> {
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    const lines = await this.prisma.reservationLine.findMany({
      where: {
        productId,
        variantId: variantId ?? NIL_UUID,
        reservation: { organizationId, warehouseId, status: { in: ['RESERVED', 'PARTIALLY_CONSUMED'] } },
      },
      include: { reservation: { select: { reservationNo: true, status: true, expiresAt: true, id: true } } },
    });
    return lines
      .map((l) => ({
        reservationId: l.reservation.id,
        reservationNo: l.reservation.reservationNo,
        lineId: l.id,
        status: l.reservation.status,
        remaining: D(l.quantity).sub(l.consumedQuantity).toString(),
        expiresAt: l.reservation.expiresAt ? l.reservation.expiresAt.toISOString() : null,
      }))
      .filter((r) => Number(r.remaining) > 0);
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<ReservationResponse> {
    return this.toResponse(await this.load(organizationId, user, id));
  }

  // ---- create (DRAFT) ----

  async create(organizationId: string, user: RequestUser, dto: CreateReservationDto): Promise<ReservationResponse> {
    const wh = await this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, organizationId }, select: { id: true, status: true } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    if (!isWarehouseAllowed(user, dto.warehouseId)) throw new ForbiddenException('You do not have access to this warehouse');
    if (wh.status !== 'ACTIVE') throw new BadRequestException('Warehouse is not active');

    // Resolve + validate every line before writing anything.
    const lines = await Promise.all(dto.lines.map((l) => this.resolveLine(organizationId, dto.warehouseId, l)));

    const created = await this.prisma.$transaction(async (tx) => {
      const reservationNo = await this.nextNumber(tx, organizationId);
      return tx.inventoryReservation.create({
        data: {
          organizationId,
          reservationNo,
          warehouseId: dto.warehouseId,
          sourceType: dto.sourceType ?? 'MANUAL',
          sourceId: dto.sourceId ?? null,
          status: 'DRAFT',
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          notes: dto.notes ?? null,
          createdById: user.userId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              locationId: l.locationId,
              quantity: new Prisma.Decimal(l.quantity),
            })),
          },
        },
        include: RESERVATION_INCLUDE,
      });
    });

    await this.audit.record({
      organizationId, userId: user.userId, action: 'reservation.created', entityType: 'reservation',
      entityId: created.id, entityDisplay: created.reservationNo, warehouseId: dto.warehouseId,
      newValue: { lines: lines.length, sourceType: created.sourceType },
    });
    return this.toResponse(created);
  }

  // ---- confirm (DRAFT -> RESERVED): the availability commitment ----

  async confirm(organizationId: string, user: RequestUser, id: string): Promise<ReservationResponse> {
    const existing = await this.load(organizationId, user, id);
    if (existing.status === 'RESERVED') return this.toResponse(existing); // idempotent replay
    this.assertTransition(existing.status, 'RESERVED');

    const updated = await this.prisma.$transaction(async (tx) => {
      // Deterministic lock order across all lines to avoid deadlocks on multi-line reservations.
      const ordered = [...existing.lines].sort((a, b) => `${a.productId}|${a.variantId}`.localeCompare(`${b.productId}|${b.variantId}`));
      for (const line of ordered) {
        // Availability is the product/warehouse position aggregated across lots (batch stock lives on
        // lot rows); the reserved commitment is written to the NIL row (ADR 0007 §7).
        const agg = await this.lockGrainAggregate(tx, organizationId, line.productId, line.variantId, existing.warehouseId);
        const available = agg.onHand.sub(agg.reserved).sub(agg.quarantined);
        if (D(line.quantity).gt(available)) {
          throw new BadRequestException(
            `Insufficient available stock for ${line.product.sku}: requested ${D(line.quantity).toString()}, available ${available.toString()}`,
          );
        }
        await tx.inventoryBalance.update({
          where: { id: agg.nilId },
          data: { reserved: { increment: line.quantity }, version: { increment: 1 } },
        });
      }
      return tx.inventoryReservation.update({
        where: { id },
        data: { status: 'RESERVED', confirmedAt: new Date() },
        include: RESERVATION_INCLUDE,
      });
    });

    await this.audit.record({
      organizationId, userId: user.userId, action: 'reservation.confirmed', entityType: 'reservation',
      entityId: id, entityDisplay: existing.reservationNo, warehouseId: existing.warehouseId,
      oldValue: { status: existing.status }, newValue: { status: 'RESERVED' },
    });
    return this.toResponse(updated);
  }

  // ---- release / cancel: return remaining reserved to availability ----

  async release(organizationId: string, user: RequestUser, id: string): Promise<ReservationResponse> {
    return this.returnReserved(organizationId, user, id, 'RELEASED');
  }

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<ReservationResponse> {
    return this.returnReserved(organizationId, user, id, 'CANCELLED');
  }

  private async returnReserved(
    organizationId: string,
    user: RequestUser,
    id: string,
    target: 'RELEASED' | 'CANCELLED',
  ): Promise<ReservationResponse> {
    const existing = await this.load(organizationId, user, id);
    if (existing.status === target) return this.toResponse(existing); // idempotent replay
    this.assertTransition(existing.status, target);

    // Only a confirmed (RESERVED/PARTIALLY_CONSUMED) reservation holds reserved stock to return.
    const holdsStock = existing.status === 'RESERVED' || existing.status === 'PARTIALLY_CONSUMED';

    const updated = await this.prisma.$transaction(async (tx) => {
      if (holdsStock) await this.releaseLineReserved(tx, organizationId, existing.warehouseId, existing.lines);
      return tx.inventoryReservation.update({
        where: { id },
        data: { status: target, completedAt: new Date() },
        include: RESERVATION_INCLUDE,
      });
    });

    await this.audit.record({
      organizationId, userId: user.userId,
      action: target === 'RELEASED' ? 'reservation.released' : 'reservation.cancelled',
      entityType: 'reservation', entityId: id, entityDisplay: existing.reservationNo, warehouseId: existing.warehouseId,
      oldValue: { status: existing.status }, newValue: { status: target },
    });
    return this.toResponse(updated);
  }

  // ---- consumption (called by the release-posting flow, 2B.1B) ----

  /**
   * Validate that `qty` can be consumed from a reservation line for a release in `warehouseId` /
   * `productId` / `variantId`. Returns the remaining reserved. Read-only.
   */
  async validateConsumable(
    organizationId: string,
    reservationLineId: string,
    warehouseId: string,
    productId: string,
    variantId: string,
    qty: Prisma.Decimal,
  ): Promise<void> {
    const line = await this.prisma.reservationLine.findFirst({
      where: { id: reservationLineId, reservation: { organizationId } },
      include: { reservation: { select: { warehouseId: true, status: true } } },
    });
    if (!line) throw new BadRequestException('Reservation line not found');
    const st = line.reservation.status;
    if (st !== 'RESERVED' && st !== 'PARTIALLY_CONSUMED') {
      throw new BadRequestException(`Reservation is ${st} and cannot be consumed`);
    }
    if (line.reservation.warehouseId !== warehouseId) throw new BadRequestException('Reservation is for a different warehouse');
    if (line.productId !== productId || line.variantId !== variantId) {
      throw new BadRequestException('Release line does not match the reserved product/variant');
    }
    const remaining = D(line.quantity).sub(line.consumedQuantity);
    if (qty.gt(remaining)) {
      throw new BadRequestException(`Consumption ${qty.toString()} exceeds remaining reserved ${remaining.toString()}`);
    }
  }

  /**
   * Within the caller's transaction: record `qty` consumed against a reservation line and roll the
   * parent reservation's status (PARTIALLY_CONSUMED / CONSUMED). The reserved-bucket decrement itself
   * rides the release movement (reservedDelta) — this only advances reservation metadata.
   * Returns the reservationId + its new status for the caller to audit.
   */
  async recordConsumption(
    tx: Tx,
    reservationLineId: string,
    qty: Prisma.Decimal,
  ): Promise<{ reservationId: string; reservationNo: string; status: ReservationStatus }> {
    const line = await tx.reservationLine.update({
      where: { id: reservationLineId },
      data: { consumedQuantity: { increment: qty } },
      select: { reservationId: true },
    });
    const all = await tx.reservationLine.findMany({
      where: { reservationId: line.reservationId },
      select: { quantity: true, consumedQuantity: true },
    });
    const fullyConsumed = all.every((l) => D(l.consumedQuantity).gte(l.quantity));
    const status: ReservationStatus = fullyConsumed ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
    const res = await tx.inventoryReservation.update({
      where: { id: line.reservationId },
      data: { status, ...(fullyConsumed ? { completedAt: new Date() } : {}) },
      select: { id: true, reservationNo: true, status: true },
    });
    return { reservationId: res.id, reservationNo: res.reservationNo, status: res.status };
  }

  // ---- expiry (2B.1C) ----

  /**
   * Expire every reservation whose `expiresAt <= now` and is still holding stock. Expiry is a state
   * transition (never deletion): it returns ONLY the remaining reserved quantity to availability,
   * preserves `consumedQuantity`, sets status EXPIRED, and audits. Idempotent — each reservation is
   * claimed with a status-guarded update, so a second run (or concurrent runner) can't double-release.
   */
  async expireDue(organizationId?: string, actorId?: string | null): Promise<{ expired: number }> {
    const now = new Date();
    const due = await this.prisma.inventoryReservation.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: ['RESERVED', 'PARTIALLY_CONSUMED'] },
        expiresAt: { not: null, lte: now },
      },
      select: { id: true },
      take: 500,
    });
    if (due.length === 0) return { expired: 0 };

    const correlationId = randomUUID(); // one correlation id for the whole batch run
    let expired = 0;
    for (const { id } of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        // Claim: only transition if still active — a losing/concurrent run gets count 0 and skips.
        const claim = await tx.inventoryReservation.updateMany({
          where: { id, status: { in: ['RESERVED', 'PARTIALLY_CONSUMED'] } },
          data: { status: 'EXPIRED', completedAt: now },
        });
        if (claim.count === 0) return null;
        const res = await tx.inventoryReservation.findUniqueOrThrow({
          where: { id },
          include: RESERVATION_INCLUDE,
        });
        await this.releaseLineReserved(tx, res.organizationId, res.warehouseId, res.lines);
        return res;
      });
      if (!done) continue;
      expired += 1;
      await this.audit.record({
        organizationId: done.organizationId, userId: actorId ?? null, source: 'SYSTEM', correlationId,
        action: 'reservation.expired', entityType: 'reservation', entityId: done.id,
        entityDisplay: done.reservationNo, warehouseId: done.warehouseId, newValue: { status: 'EXPIRED' },
      });
    }
    if (expired > 0) this.logger.log(`Expired ${expired} reservation(s)`);
    return { expired };
  }

  /** Decrement each line's remaining reserved from its balance bucket (shared by release/cancel/expire). */
  private async releaseLineReserved(
    tx: Tx,
    organizationId: string,
    warehouseId: string,
    lines: Array<{ productId: string; variantId: string; quantity: Prisma.Decimal; consumedQuantity: Prisma.Decimal }>,
  ): Promise<void> {
    const ordered = [...lines].sort((a, b) => `${a.productId}|${a.variantId}`.localeCompare(`${b.productId}|${b.variantId}`));
    for (const line of ordered) {
      const remaining = D(line.quantity).sub(line.consumedQuantity);
      if (remaining.lte(0)) continue;
      const bal = await this.lockBalance(tx, organizationId, line.productId, line.variantId, warehouseId);
      const newReserved = bal.reserved.sub(remaining);
      await tx.inventoryBalance.update({
        where: { id: bal.id },
        data: { reserved: newReserved.lt(0) ? new Prisma.Decimal(0) : newReserved, version: { increment: 1 } },
      });
    }
  }

  // ---- helpers ----

  private readonly TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
    DRAFT: ['RESERVED', 'CANCELLED'],
    RESERVED: ['PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'EXPIRED', 'CANCELLED'],
    PARTIALLY_CONSUMED: ['CONSUMED', 'RELEASED', 'EXPIRED', 'CANCELLED'],
    CONSUMED: [],
    RELEASED: [],
    EXPIRED: [],
    CANCELLED: [],
  };

  private assertTransition(from: ReservationStatus, to: ReservationStatus): void {
    if (!this.TRANSITIONS[from].includes(to)) {
      throw new ConflictException(`Cannot move a ${from} reservation to ${to}`);
    }
  }

  private async resolveLine(
    organizationId: string,
    warehouseId: string,
    line: { productId: string; variantId?: string; locationId?: string; quantity: number },
  ): Promise<{ productId: string; variantId: string; locationId: string | null; quantity: number }> {
    const product = await this.prisma.product.findFirst({
      where: { id: line.productId, organizationId },
      select: { id: true, status: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (product.status !== 'ACTIVE') throw new BadRequestException('Cannot reserve a non-active product');

    let variantId = NIL_UUID;
    if (line.variantId) {
      const v = await this.prisma.productVariant.findFirst({
        where: { id: line.variantId, productId: line.productId, organizationId },
        select: { status: true },
      });
      if (!v) throw new BadRequestException('Variant does not belong to this product');
      if (v.status !== 'ACTIVE') throw new BadRequestException('Cannot reserve a non-active variant');
      variantId = line.variantId;
    }

    if (line.locationId) {
      const loc = await this.prisma.warehouseLocation.findFirst({
        where: { id: line.locationId, warehouseId, organizationId },
        select: { status: true },
      });
      if (!loc) throw new BadRequestException('Location not found in this warehouse');
      if (loc.status !== 'ACTIVE') throw new BadRequestException('Cannot reserve at a non-active location');
    }
    return { productId: line.productId, variantId, locationId: line.locationId ?? null, quantity: line.quantity };
  }

  /**
   * Lock the whole product/warehouse position (all lot rows) FOR UPDATE and return the NIL-lot row id
   * plus the aggregate buckets across lots (ADR 0007 §7). Reservations commit at the product level: for
   * batch stock the physical on-hand lives on lot rows, so availability must aggregate across them, while
   * the `reserved` commitment is written to the NIL row. For non-batch stock only the NIL row exists, so
   * this reduces to the prior single-row behaviour.
   */
  private async lockGrainAggregate(
    tx: Tx,
    organizationId: string,
    productId: string,
    variantId: string,
    warehouseId: string,
  ): Promise<{ nilId: string; onHand: Prisma.Decimal; reserved: Prisma.Decimal; quarantined: Prisma.Decimal }> {
    await tx.$executeRaw`
      INSERT INTO inventory_balances (id, organization_id, product_id, variant_id, warehouse_id, lot_id, updated_at)
      VALUES (gen_random_uuid(), ${organizationId}::uuid, ${productId}::uuid, ${variantId}::uuid, ${warehouseId}::uuid, ${NIL_UUID}::uuid, now())
      ON CONFLICT (organization_id, product_id, variant_id, warehouse_id, lot_id) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ id: string; lot_id: string; on_hand: string; reserved: string; quarantined: string }>>`
      SELECT id, lot_id::text AS lot_id, on_hand::text, reserved::text, quarantined::text
      FROM inventory_balances
      WHERE organization_id = ${organizationId}::uuid AND product_id = ${productId}::uuid
        AND variant_id = ${variantId}::uuid AND warehouse_id = ${warehouseId}::uuid
      FOR UPDATE`;
    const nil = rows.find((r) => r.lot_id === NIL_UUID)!;
    const sum = (k: 'on_hand' | 'reserved' | 'quarantined') => rows.reduce((a, r) => a.add(r[k]), new Prisma.Decimal(0));
    return { nilId: nil.id, onHand: sum('on_hand'), reserved: sum('reserved'), quarantined: sum('quarantined') };
  }

  /** Insert-if-missing then SELECT … FOR UPDATE — the balance-locking pattern from the posting service. */
  private async lockBalance(
    tx: Tx,
    organizationId: string,
    productId: string,
    variantId: string,
    warehouseId: string,
  ): Promise<{ id: string; onHand: Prisma.Decimal; reserved: Prisma.Decimal; quarantined: Prisma.Decimal }> {
    // Reservations are lot-agnostic (ADR 0007 §7): they commit against the product/warehouse position,
    // which for non-batch stock is the NIL-lot balance row. Lot-level allocation happens at release (2C.1B).
    await tx.$executeRaw`
      INSERT INTO inventory_balances (id, organization_id, product_id, variant_id, warehouse_id, lot_id, updated_at)
      VALUES (gen_random_uuid(), ${organizationId}::uuid, ${productId}::uuid, ${variantId}::uuid, ${warehouseId}::uuid, ${NIL_UUID}::uuid, now())
      ON CONFLICT (organization_id, product_id, variant_id, warehouse_id, lot_id) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ id: string; on_hand: string; reserved: string; quarantined: string }>>`
      SELECT id, on_hand::text, reserved::text, quarantined::text
      FROM inventory_balances
      WHERE organization_id = ${organizationId}::uuid AND product_id = ${productId}::uuid
        AND variant_id = ${variantId}::uuid AND warehouse_id = ${warehouseId}::uuid AND lot_id = ${NIL_UUID}::uuid
      FOR UPDATE`;
    const r = rows[0]!;
    return { id: r.id, onHand: D(r.on_hand), reserved: D(r.reserved), quarantined: D(r.quarantined) };
  }

  private async nextNumber(tx: Tx, organizationId: string): Promise<string> {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'reservation' } },
      create: { organizationId, key: 'reservation', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `RSV-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, user: RequestUser, id: string): Promise<ReservationRow> {
    const r = await this.prisma.inventoryReservation.findFirst({ where: { id, organizationId }, include: RESERVATION_INCLUDE });
    if (!r) throw new NotFoundException('Reservation not found');
    if (!isWarehouseAllowed(user, r.warehouseId)) throw new NotFoundException('Reservation not found');
    return r;
  }

  private toResponse(r: ReservationRow): ReservationResponse {
    return {
      id: r.id,
      reservationNo: r.reservationNo,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      status: r.status,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      notes: r.notes,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      lines: r.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productSku: l.product.sku,
        productName: l.product.name,
        variantId: l.variantId === NIL_UUID ? null : l.variantId,
        locationId: l.locationId,
        quantity: l.quantity.toString(),
        consumedQuantity: l.consumedQuantity.toString(),
        remaining: D(l.quantity).sub(l.consumedQuantity).toString(),
      })),
    };
  }
}
