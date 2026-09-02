import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReturnStatus } from '@prisma/client';
import type { ReturnResponse, ReturnType } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import type { RequestUser } from '../common/request-user';
import { D, NIL_UUID } from '../inventory/inventory.constants';
import { CreateReturnDto, ReceiveReturnDto } from './dto/return.dto';

export interface ReturnListFilter {
  status?: ReturnStatus;
  type?: ReturnType;
  warehouseId?: string;
  q?: string; // return number or product sku
}

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
    private readonly posting: InventoryPostingService,
  ) {}

  // ---- reads ----

  async list(organizationId: string, user: RequestUser, filter: ReturnListFilter = {}): Promise<ReturnResponse[]> {
    const scope = user.warehouseScope;
    const rows = await this.prisma.inventoryReturn.findMany({
      where: {
        organizationId,
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
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
              quantity: new Prisma.Decimal(l.quantity),
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

    // Post RETURN_RECEIPT movements FIRST (idempotency-keyed so a retry never double-raises quarantine),
    // then persist received quantities + status — the same order the receiving flow uses.
    await this.posting.returnReceipt(
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
        })),
      },
    );

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const r of received) {
        await tx.returnLine.update({ where: { id: r.line.id }, data: { receivedQuantity: r.qty } });
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

  // ---- helpers ----

  private async resolveLine(
    organizationId: string,
    warehouseId: string,
    line: { productId: string; variantId?: string; locationId?: string; quantity: number },
  ): Promise<{ productId: string; variantId: string; locationId: string | null; quantity: number }> {
    // Invariant 10: only ACTIVE products/variants/locations can start a new return intake.
    const product = await this.prisma.product.findFirst({
      where: { id: line.productId, organizationId },
      select: { status: true },
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
    return { productId: line.productId, variantId, locationId: line.locationId ?? null, quantity: line.quantity };
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
          dispositions: l.dispositions.map((d) => ({
            id: d.id,
            type: d.type,
            quantity: d.quantity.toString(),
            reason: d.reason,
            notes: d.notes,
            performedById: d.performedById,
            performedAt: d.performedAt.toISOString(),
          })),
        };
      }),
    };
  }
}
