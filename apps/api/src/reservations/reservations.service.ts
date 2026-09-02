import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import type { ReservationResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { isWarehouseAllowed } from '../common/warehouse-scope';
import { D, NIL_UUID } from '../inventory/inventory.constants';
import { CreateReservationDto } from './dto/reservation.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- reads ----

  async list(organizationId: string, user: RequestUser, status?: ReservationStatus): Promise<ReservationResponse[]> {
    const scope = user.warehouseScope;
    const rows = await this.prisma.inventoryReservation.findMany({
      where: {
        organizationId,
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
        ...(status ? { status } : {}),
      },
      include: RESERVATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toResponse(r));
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
        const bal = await this.lockBalance(tx, organizationId, line.productId, line.variantId, existing.warehouseId);
        const available = bal.onHand.sub(bal.reserved).sub(bal.quarantined);
        if (D(line.quantity).gt(available)) {
          throw new BadRequestException(
            `Insufficient available stock for ${line.product.sku}: requested ${D(line.quantity).toString()}, available ${available.toString()}`,
          );
        }
        await tx.inventoryBalance.update({
          where: { id: bal.id },
          data: { reserved: bal.reserved.add(line.quantity), version: { increment: 1 } },
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
      if (holdsStock) {
        const ordered = [...existing.lines].sort((a, b) => `${a.productId}|${a.variantId}`.localeCompare(`${b.productId}|${b.variantId}`));
        for (const line of ordered) {
          const remaining = D(line.quantity).sub(line.consumedQuantity);
          if (remaining.lte(0)) continue;
          const bal = await this.lockBalance(tx, organizationId, line.productId, line.variantId, existing.warehouseId);
          const newReserved = bal.reserved.sub(remaining);
          await tx.inventoryBalance.update({
            where: { id: bal.id },
            data: { reserved: newReserved.lt(0) ? new Prisma.Decimal(0) : newReserved, version: { increment: 1 } },
          });
        }
      }
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

  /** Insert-if-missing then SELECT … FOR UPDATE — the balance-locking pattern from the posting service. */
  private async lockBalance(
    tx: Tx,
    organizationId: string,
    productId: string,
    variantId: string,
    warehouseId: string,
  ): Promise<{ id: string; onHand: Prisma.Decimal; reserved: Prisma.Decimal; quarantined: Prisma.Decimal }> {
    await tx.$executeRaw`
      INSERT INTO inventory_balances (id, organization_id, product_id, variant_id, warehouse_id, updated_at)
      VALUES (gen_random_uuid(), ${organizationId}::uuid, ${productId}::uuid, ${variantId}::uuid, ${warehouseId}::uuid, now())
      ON CONFLICT (organization_id, product_id, variant_id, warehouse_id) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ id: string; on_hand: string; reserved: string; quarantined: string }>>`
      SELECT id, on_hand::text, reserved::text, quarantined::text
      FROM inventory_balances
      WHERE organization_id = ${organizationId}::uuid AND product_id = ${productId}::uuid
        AND variant_id = ${variantId}::uuid AND warehouse_id = ${warehouseId}::uuid
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
