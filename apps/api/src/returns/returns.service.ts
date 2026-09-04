import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MovementType, Prisma, ReturnStatus, SerialStatus } from '@prisma/client';
import { PERMISSIONS, type DispositionType, type QuarantineBreakdownRow, type ReturnResponse, type ReturnType } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CostingService, type CostBasisComponent } from '../inventory/costing.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { SerialsService } from '../serials/serials.service';
import type { RequestUser } from '../common/request-user';
import { BucketDeltas, D, NIL_UUID, ZERO } from '../inventory/inventory.constants';
import { CreateReturnDto, CreateDispositionDto, ReceiveReturnDto } from './dto/return.dto';

export interface ReturnListFilter {
  status?: ReturnStatus;
  type?: ReturnType;
  warehouseId?: string;
  q?: string; // return number or product sku
  sourceReference?: string;
  from?: string;
  to?: string;
  hasQuarantine?: boolean; // returns still holding quarantined stock (RECEIVED | PARTIALLY_DISPOSED)
}

/** Statuses that, by construction, still hold remaining quarantine (received but not fully disposed). */
const QUARANTINE_HOLDING: ReturnStatus[] = ['RECEIVED', 'PARTIALLY_DISPOSED'];

type ReturnRow = Prisma.InventoryReturnGetPayload<{
  include: {
    warehouse: { select: { code: true } };
    lines: {
      include: {
        product: { select: { sku: true; name: true } };
        dispositions: true;
      };
    };
  };
}>;

const RETURN_INCLUDE = {
  warehouse: { select: { code: true } },
  lines: {
    include: {
      product: { select: { sku: true, name: true } },
      dispositions: { orderBy: { performedAt: 'asc' } },
    },
    orderBy: { id: 'asc' },
  },
} as const;

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly costing: CostingService,
    private readonly posting: InventoryPostingService,
    private readonly serials: SerialsService,
  ) {}

  // ---- reads ----

  async list(organizationId: string, user: RequestUser, filter: ReturnListFilter = {}): Promise<ReturnResponse[]> {
    const scope = user.warehouseScope;
    const rows = await this.prisma.inventoryReturn.findMany({
      where: {
        organizationId,
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
        ...(filter.status
          ? { status: filter.status }
          : filter.hasQuarantine
            ? { status: { in: QUARANTINE_HOLDING } }
            : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.sourceReference ? { sourceReference: { contains: filter.sourceReference, mode: 'insensitive' } } : {}),
        ...(filter.from || filter.to
          ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } }
          : {}),
        ...(filter.q
          ? {
              OR: [
                { returnNo: { contains: filter.q, mode: 'insensitive' } },
                { lines: { some: { product: { sku: { contains: filter.q, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
      include: RETURN_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toResponse(r));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<ReturnResponse> {
    return this.toResponse(await this.load(organizationId, user, id));
  }

  /** The active return lines composing a balance's `quarantined` bucket (stock drill-down). */
  async quarantineBreakdown(
    organizationId: string,
    user: RequestUser,
    productId: string,
    warehouseId: string,
    variantId?: string,
  ): Promise<QuarantineBreakdownRow[]> {
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    const lines = await this.prisma.returnLine.findMany({
      where: {
        productId,
        variantId: variantId ?? NIL_UUID,
        return: { organizationId, warehouseId, status: { in: QUARANTINE_HOLDING } },
      },
      include: { return: { select: { id: true, returnNo: true, type: true, status: true, receivedAt: true } } },
    });
    return lines
      .map((l) => ({
        returnId: l.return.id,
        returnNo: l.return.returnNo,
        lineId: l.id,
        type: l.return.type,
        status: l.return.status,
        remaining: D(l.receivedQuantity).sub(l.disposedQuantity).toString(),
        receivedAt: l.return.receivedAt ? l.return.receivedAt.toISOString() : null,
      }))
      .filter((r) => Number(r.remaining) > 0);
  }

  // ---- create (DRAFT) ----

  async create(organizationId: string, user: RequestUser, dto: CreateReturnDto): Promise<ReturnResponse> {
    // Invariant 10: an inactive/archived warehouse cannot start a new return intake.
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);

    const lines = await Promise.all(dto.lines.map((l) => this.resolveLine(organizationId, dto.warehouseId, l)));

    const created = await this.prisma.$transaction(async (tx) => {
      const returnNo = await this.nextNumber(tx, organizationId);
      return tx.inventoryReturn.create({
        data: {
          organizationId,
          returnNo,
          type: dto.type,
          warehouseId: dto.warehouseId,
          sourceReference: dto.sourceReference ?? null,
          status: 'DRAFT',
          reason: dto.reason ?? null,
          notes: dto.notes ?? null,
          createdById: user.userId,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              locationId: l.locationId,
              lotId: l.lotId,
              quantity: new Prisma.Decimal(l.quantity),
              serialNumbers: l.serialNumbers,
            })),
          },
        },
        include: RETURN_INCLUDE,
      });
    });

    await this.audit.record({
      organizationId, userId: user.userId, action: 'return.created', entityType: 'return',
      entityId: created.id, entityDisplay: created.returnNo, warehouseId: dto.warehouseId,
      newValue: { type: created.type, lines: lines.length },
    });
    return this.toResponse(created);
  }

  // ---- receive (DRAFT -> RECEIVED): intake into quarantine ----

  async receive(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: ReceiveReturnDto = {},
  ): Promise<ReturnResponse> {
    const existing = await this.load(organizationId, user, id);
    // Idempotent replay: an already-received return returns as-is.
    if (existing.receivedAt) return this.toResponse(existing);
    if (existing.status !== 'DRAFT') throw new ConflictException(`A ${existing.status} return cannot be received`);

    const overrides = new Map((dto.lines ?? []).map((l) => [l.lineId, l.receivedQuantity]));
    for (const l of dto.lines ?? []) {
      if (!existing.lines.some((el) => el.id === l.lineId)) {
        throw new BadRequestException(`Line ${l.lineId} does not belong to this return`);
      }
    }

    // Resolve received quantity per line (override, else declared). Invariant 1: received qty > 0.
    const received = existing.lines.map((line) => {
      const qty = overrides.has(line.id) ? D(overrides.get(line.id)!) : D(line.quantity);
      return { line, qty };
    });
    const postable = received.filter((r) => r.qty.gt(0));
    if (postable.length === 0) throw new BadRequestException('At least one line must receive a positive quantity');

    // A serialized line receives exactly its declared serial set — a differing override would desync the
    // registry from the quantity, so reject it (ADR 0012 §9).
    for (const r of postable) {
      if (r.line.serialNumbers.length > 0 && !r.qty.equals(D(r.line.serialNumbers.length))) {
        throw new BadRequestException('A serialized return line must receive exactly its captured serial count');
      }
    }

    // Post RETURN_RECEIPT movements FIRST (idempotency-keyed so a retry never double-raises quarantine),
    // then persist received quantities + status — the same order the receiving flow uses.
    // FIFO return receipt requires attributable historical cost basis. Serialized returns restore the
    // original issued basis; untraceable FIFO returns are rejected by posting until an explicit valuation
    // source is provided.
    const costBasisByLine = new Map<string, CostBasisComponent[]>();
    for (const r of postable) {
      if (r.line.serialNumbers.length === 0) continue;
      const strategy = await this.costing.strategyFor(this.prisma, organizationId, r.line.productId);
      if (strategy !== 'FIFO') continue;
      const serials = await this.prisma.inventorySerial.findMany({
        where: {
          organizationId,
          productId: r.line.productId,
          variantId: r.line.variantId,
          serialNumber: { in: r.line.serialNumbers },
        },
        select: { serialNumber: true, lastMovementId: true },
      });
      const bySerial = new Map(serials.map((s) => [s.serialNumber, s]));
      const basis: CostBasisComponent[] = [];
      for (const sn of r.line.serialNumbers) {
        const issuedMovementId = bySerial.get(sn)?.lastMovementId;
        if (!issuedMovementId) {
          throw new BadRequestException('FIFO serialized returns require a traceable original issue movement');
        }
        const one = await this.costing.basisAllocatedFromMovementInTx(this.prisma, organizationId, issuedMovementId, D(1));
        if (!one) {
          throw new BadRequestException('FIFO serialized returns require a traceable original issue cost basis');
        }
        basis.push(...one);
      }
      costBasisByLine.set(r.line.id, basis);
    }

    const movements = await this.posting.returnReceipt(
      {
        organizationId,
        actorId: user.userId,
        idempotencyKey: `return_receive:${existing.id}`,
        reason: existing.reason,
      },
      {
        warehouseId: existing.warehouseId,
        referenceId: existing.id,
        lines: postable.map((r) => ({
          productId: r.line.productId,
          variantId: r.line.variantId === NIL_UUID ? null : r.line.variantId,
          quantity: r.qty,
          locationId: r.line.locationId,
          lotId: r.line.lotId, // intake lands in quarantine under the recognized lot (ADR 0007)
          costBasis: costBasisByLine.get(r.line.id),
        })),
      },
    );

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const r of received) {
        await tx.returnLine.update({ where: { id: r.line.id }, data: { receivedQuantity: r.qty } });
      }
      // Returned serials move ISSUED → QUARANTINED, atomically with intake (movements[i] ↔ postable[i]).
      for (let i = 0; i < postable.length; i += 1) {
        const line = postable[i]!.line;
        if (line.serialNumbers.length > 0) {
          await this.serials.transitionExistingInTx(tx, organizationId, {
            productId: line.productId, variantKey: line.variantId, serialNumbers: line.serialNumbers,
            expectFrom: [SerialStatus.ISSUED], to: SerialStatus.QUARANTINED,
            setWarehouseId: existing.warehouseId, setLocationId: line.locationId, movementId: movements[i]!.id,
          });
        }
      }
      await tx.inventoryReturn.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: now } });
    });

    await this.audit.record({
      organizationId, userId: user.userId, action: 'return.received', entityType: 'return',
      entityId: id, entityDisplay: existing.returnNo, warehouseId: existing.warehouseId,
      oldValue: { status: existing.status }, newValue: { status: 'RECEIVED', lines: postable.length },
    });
    return this.get(organizationId, user, id);
  }

  // ---- cancel (only before receipt) ----

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<ReturnResponse> {
    const existing = await this.load(organizationId, user, id);
    if (existing.status === 'CANCELLED') return this.toResponse(existing); // idempotent
    // Invariant 8: cancel is allowed only before receipt.
    if (existing.status !== 'DRAFT') throw new ConflictException(`A ${existing.status} return cannot be cancelled`);

    const updated = await this.prisma.inventoryReturn.update({
      where: { id }, data: { status: 'CANCELLED', completedAt: new Date() }, include: RETURN_INCLUDE,
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'return.cancelled', entityType: 'return',
      entityId: id, entityDisplay: existing.returnNo, warehouseId: existing.warehouseId,
      oldValue: { status: existing.status }, newValue: { status: 'CANCELLED' },
    });
    return this.toResponse(updated);
  }

  // ---- disposition (RECEIVED/PARTIALLY_DISPOSED -> ... -> COMPLETED), 2B.2B ----

  /**
   * Split quarantined returned stock into one disposition outcome, posted immutably through the ledger
   * (ADR 0006). Concurrency-safe: the return line is locked FOR UPDATE, remaining quarantine is read
   * under that lock, and the ledger's quarantined/damaged negative-guards act as a second backstop.
   * The document status rolls up mechanically from ALL lines. Idempotent when given a client key.
   */
  async dispose(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: CreateDispositionDto,
  ): Promise<ReturnResponse> {
    const existing = await this.load(organizationId, user, id);
    if (existing.status !== 'RECEIVED' && existing.status !== 'PARTIALLY_DISPOSED') {
      throw new ConflictException(`A ${existing.status} return cannot be dispositioned`);
    }
    if (!existing.lines.some((l) => l.id === dto.lineId)) {
      throw new BadRequestException('Line does not belong to this return');
    }
    // Permission split (ADR 0006): condition outcomes (RESTOCK/DAMAGED) need return.inspect (the route
    // floor); physically removing stock (RETURN_TO_SUPPLIER/DISPOSE) additionally needs return.dispose.
    const destructive = dto.type === 'RETURN_TO_SUPPLIER' || dto.type === 'DISPOSE';
    if (destructive && !user.permissions.includes(PERMISSIONS.RETURN_DISPOSE)) {
      throw new ForbiddenException('return.dispose permission is required for this outcome');
    }

    const qty = new Prisma.Decimal(dto.quantity);
    const { movementType, deltas } = this.dispositionEffect(dto.type, qty);
    const serialTarget = this.dispositionSerialTarget(dto.type);
    const idemKey = dto.idempotencyKey ? `return_disposition:${organizationId}:${dto.idempotencyKey}` : randomUUID();

    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize concurrent dispositions on THIS line; read the durable remaining under the lock.
        const rows = await tx.$queryRaw<Array<{ received: string; disposed: string; product_id: string; variant_id: string; location_id: string | null; lot_id: string | null }>>`
          SELECT received_quantity::text AS received, disposed_quantity::text AS disposed, product_id, variant_id, location_id, lot_id
          FROM return_lines WHERE id = ${dto.lineId}::uuid FOR UPDATE`;
        const r = rows[0];
        if (!r) throw new BadRequestException('Line not found');

        // Idempotent replay: this disposition key already posted its movement — do nothing more.
        if (dto.idempotencyKey) {
          const prior = await tx.inventoryMovement.findFirst({ where: { organizationId, idempotencyKey: idemKey } });
          if (prior) return;
        }

        const remaining = D(r.received).sub(r.disposed);
        if (qty.gt(remaining)) {
          throw new BadRequestException(`Disposition ${qty.toString()} exceeds remaining quarantined ${remaining.toString()}`);
        }

        // Serial validation (ADR 0012 §9). A serialized product needs exactly `quantity` QUARANTINED serials
        // of this line — validated here, before the movement posts, so an invalid serial aborts the tx.
        const product = await tx.product.findFirst({ where: { id: r.product_id, organizationId }, select: { isSerialized: true } });
        const dispoSerials = this.serials.normalize(dto.serialNumbers ?? [], r.product_id);
        if (product?.isSerialized) {
          if (!qty.isInteger()) throw new BadRequestException('A serialized product must be dispositioned in whole units');
          if (dispoSerials.length !== qty.toNumber()) {
            throw new BadRequestException(`Expected ${qty.toString()} serial(s) for this disposition, got ${dispoSerials.length}`);
          }
        } else if (dispoSerials.length > 0) {
          throw new BadRequestException('This product is not serialized and cannot carry serial numbers');
        }

        // Immutable ledger posting (balance lock + bucket negative-guards as the second guard).
        const movement = await this.posting.postLineInTx(
          tx,
          { organizationId, actorId: user.userId, idempotencyKey: idemKey, reason: dto.reason ?? null },
          {
            movementType,
            warehouseId: existing.warehouseId,
            referenceType: 'inventory_return',
            referenceId: existing.id,
            line: {
              productId: r.product_id,
              variantId: r.variant_id === NIL_UUID ? null : r.variant_id,
              quantity: qty,
              locationId: r.location_id,
              lotId: r.lot_id, // every disposition inherits the return line's lot (ADR 0007)
              deltas,
            },
          },
        );

        if (dispoSerials.length > 0) {
          await this.serials.transitionExistingInTx(tx, organizationId, {
            productId: r.product_id, variantKey: r.variant_id, serialNumbers: dispoSerials,
            expectFrom: [SerialStatus.QUARANTINED], to: serialTarget,
            setWarehouseId: existing.warehouseId, setLocationId: r.location_id, movementId: movement.id,
          });
        }

        await tx.returnDisposition.create({
          data: {
            returnLineId: dto.lineId, type: dto.type, quantity: qty, serialNumbers: dispoSerials,
            reason: dto.reason ?? null, notes: dto.notes ?? null, performedById: user.userId,
          },
        });
        await tx.returnLine.update({ where: { id: dto.lineId }, data: { disposedQuantity: { increment: qty } } });

        // Roll document status up from ALL lines — not just the one touched (mechanical received-vs-disposed).
        const all = await tx.returnLine.findMany({ where: { returnId: id }, select: { receivedQuantity: true, disposedQuantity: true } });
        const totalReceived = all.reduce((a, l) => a.add(l.receivedQuantity), ZERO);
        const totalDisposed = all.reduce((a, l) => a.add(l.disposedQuantity), ZERO);
        const completed = totalDisposed.gte(totalReceived);
        await tx.inventoryReturn.update({
          where: { id },
          data: { status: completed ? 'COMPLETED' : 'PARTIALLY_DISPOSED', completedAt: completed ? new Date() : null },
        });
      });
    } catch (e) {
      // A concurrent replay with the same key lost the movement-insert race — treat as idempotent.
      if (!this.isUniqueViolation(e)) throw e;
    }

    await this.audit.record({
      organizationId, userId: user.userId, action: 'return.dispositioned', entityType: 'return',
      entityId: id, entityDisplay: existing.returnNo, warehouseId: existing.warehouseId,
      newValue: { type: dto.type, quantity: qty.toString(), lineId: dto.lineId },
    });
    return this.get(organizationId, user, id);
  }

  /** The immutable ledger effect of each disposition outcome (explicit deltas, ADR 0006). */
  private dispositionEffect(type: DispositionType, q: Prisma.Decimal): { movementType: MovementType; deltas: BucketDeltas } {
    const base = { onHand: ZERO, reserved: ZERO, inTransit: ZERO, quarantined: ZERO, damaged: ZERO };
    switch (type) {
      case 'RESTOCK': // release the hold; stock stays on hand and becomes sellable
        return { movementType: MovementType.RETURN_RESTOCK, deltas: { ...base, quarantined: q.neg() } };
      case 'DAMAGED': // move out of the primary pool into the damaged pool; clear the hold
        return { movementType: MovementType.DAMAGE, deltas: { ...base, onHand: q.neg(), quarantined: q.neg(), damaged: q } };
      case 'RETURN_TO_SUPPLIER': // ships out of the building; clear the hold
        return { movementType: MovementType.SUPPLIER_RETURN, deltas: { ...base, onHand: q.neg(), quarantined: q.neg() } };
      case 'DISPOSE': // scrapped out of the building; clear the hold
        return { movementType: MovementType.RETURN_DISPOSE, deltas: { ...base, onHand: q.neg(), quarantined: q.neg() } };
    }
  }

  /** The serial lifecycle target for each disposition outcome (ADR 0012 §5, §9). */
  private dispositionSerialTarget(type: DispositionType): SerialStatus {
    switch (type) {
      case 'RESTOCK': return SerialStatus.IN_STOCK; // hold released, unit sellable again
      case 'DAMAGED': return SerialStatus.DAMAGED;
      case 'RETURN_TO_SUPPLIER':
      case 'DISPOSE': return SerialStatus.DISPOSED; // leaves the building
    }
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  // ---- helpers ----

  private async resolveLine(
    organizationId: string,
    warehouseId: string,
    line: { productId: string; variantId?: string; locationId?: string; lotId?: string; quantity: number; serialNumbers?: string[] },
  ): Promise<{ productId: string; variantId: string; locationId: string | null; lotId: string | null; quantity: number; serialNumbers: string[] }> {
    // Invariant 10: only ACTIVE products/variants/locations can start a new return intake.
    const product = await this.prisma.product.findFirst({
      where: { id: line.productId, organizationId },
      select: { status: true, isBatchTracked: true, isSerialized: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (product.status !== 'ACTIVE') throw new BadRequestException('Cannot return a non-active product');

    let variantId = NIL_UUID;
    if (line.variantId) {
      const v = await this.prisma.productVariant.findFirst({
        where: { id: line.variantId, productId: line.productId, organizationId },
        select: { status: true },
      });
      if (!v) throw new BadRequestException('Variant does not belong to this product');
      if (v.status !== 'ACTIVE') throw new BadRequestException('Cannot return a non-active variant');
      variantId = line.variantId;
    }

    if (line.locationId) {
      await this.warehouses.assertLocationSelectable(organizationId, warehouseId, line.locationId);
    }

    // Lot policy (ADR 0007 §8): a batch-tracked return requires a RECOGNIZED (existing) lot of this
    // product/variant; a non-batch product must not carry one. Returns never create lots.
    let lotId: string | null = null;
    if (product.isBatchTracked) {
      if (!line.lotId) throw new BadRequestException('This product is batch-tracked; a recognized lot is required to return it');
      const lot = await this.prisma.inventoryLot.findFirst({
        where: { id: line.lotId, organizationId, productId: line.productId, variantId },
        select: { id: true },
      });
      if (!lot) throw new BadRequestException('Lot not found for this product/variant');
      lotId = lot.id;
    } else if (line.lotId) {
      throw new BadRequestException('This product is not batch-tracked and cannot carry a lot');
    }

    // Serial identities (ADR 0012 §9): a returned serialized unit must be a KNOWN, previously ISSUED serial
    // of this product — return never creates serials, and an in-stock or unknown serial is rejected.
    let serialNumbers: string[] = [];
    if (product.isSerialized) {
      if (!Number.isInteger(line.quantity)) throw new BadRequestException('A serialized product must be returned in whole units');
      serialNumbers = this.serials.normalize(line.serialNumbers ?? [], line.productId);
      if (serialNumbers.length !== line.quantity) {
        throw new BadRequestException(`Expected ${line.quantity} serial(s) for the return line, got ${serialNumbers.length}`);
      }
      const rows = await this.prisma.inventorySerial.findMany({
        where: { organizationId, productId: line.productId, variantId, serialNumber: { in: serialNumbers } },
      });
      const byNum = new Map(rows.map((r) => [r.serialNumber, r]));
      for (const sn of serialNumbers) {
        const r = byNum.get(sn);
        if (!r) throw new BadRequestException(`Serial ${sn} is not a known serial for this product`);
        if (r.status !== 'ISSUED') throw new BadRequestException(`Serial ${sn} is ${r.status}; only an ISSUED serial can be returned`);
        if (lotId && r.lotId !== lotId) throw new BadRequestException(`Serial ${sn} does not belong to the return lot`);
      }
    } else if (line.serialNumbers && line.serialNumbers.length > 0) {
      throw new BadRequestException('This product is not serialized and cannot carry serial numbers');
    }

    return { productId: line.productId, variantId, locationId: line.locationId ?? null, lotId, quantity: line.quantity, serialNumbers };
  }

  private async nextNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'return' } },
      create: { organizationId, key: 'return', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `RTN-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, user: RequestUser, id: string): Promise<ReturnRow> {
    const r = await this.prisma.inventoryReturn.findFirst({ where: { id, organizationId }, include: RETURN_INCLUDE });
    if (!r) throw new NotFoundException('Return not found');
    await this.warehouses.assertAccess(organizationId, user, r.warehouseId);
    return r;
  }

  private toResponse(r: ReturnRow): ReturnResponse {
    return {
      id: r.id,
      returnNo: r.returnNo,
      type: r.type,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      sourceReference: r.sourceReference,
      status: r.status,
      reason: r.reason,
      notes: r.notes,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
      receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      lines: r.lines.map((l) => {
        const remaining = D(l.receivedQuantity).sub(l.disposedQuantity);
        return {
          id: l.id,
          productId: l.productId,
          productSku: l.product.sku,
          productName: l.product.name,
          variantId: l.variantId === NIL_UUID ? null : l.variantId,
          locationId: l.locationId,
          quantity: l.quantity.toString(),
          receivedQuantity: l.receivedQuantity.toString(),
          disposedQuantity: l.disposedQuantity.toString(),
          remainingQuarantine: remaining.toString(),
          serialNumbers: l.serialNumbers,
          dispositions: l.dispositions.map((d) => ({
            id: d.id,
            type: d.type,
            quantity: d.quantity.toString(),
            reason: d.reason,
            notes: d.notes,
            performedById: d.performedById,
            performedAt: d.performedAt.toISOString(),
            serialNumbers: d.serialNumbers,
          })),
        };
      }),
    };
  }
}
