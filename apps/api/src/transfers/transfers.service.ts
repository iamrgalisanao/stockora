import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransferStatus } from '@prisma/client';
import type { TransferListItem, TransferResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { isWarehouseAllowed } from '../common/warehouse-scope';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import {
  CreateTransferDto,
  RejectTransferDto,
  TransferItemInputDto,
  UpdateTransferDto,
} from './dto/transfer.dto';

type TransferWithItems = Prisma.StockTransferGetPayload<{
  include: {
    sourceWarehouse: { select: { code: true } };
    destWarehouse: { select: { code: true } };
    items: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly posting: InventoryPostingService,
  ) {}

  async list(organizationId: string, user: RequestUser): Promise<TransferListItem[]> {
    const scope =
      user.warehouseScope !== null
        ? {
            OR: [
              { sourceWarehouseId: { in: user.warehouseScope } },
              { destWarehouseId: { in: user.warehouseScope } },
            ],
          }
        : {};
    const rows = await this.prisma.stockTransfer.findMany({
      where: { organizationId, ...scope },
      include: {
        sourceWarehouse: { select: { code: true } },
        destWarehouse: { select: { code: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      transferNumber: r.transferNumber,
      sourceWarehouseCode: r.sourceWarehouse.code,
      destWarehouseCode: r.destWarehouse.code,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      lineCount: r._count.items,
    }));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    this.assertEitherEnd(user, transfer);
    return this.toResponse(transfer);
  }

  async create(
    organizationId: string,
    user: RequestUser,
    dto: CreateTransferDto,
  ): Promise<TransferResponse> {
    if (dto.sourceWarehouseId === dto.destWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must differ');
    }
    // Creator must have access to both ends.
    await this.warehouses.assertAccess(organizationId, user, dto.sourceWarehouseId);
    await this.warehouses.assertAccess(organizationId, user, dto.destWarehouseId);
    await this.ensureProducts(organizationId, dto.items);

    const transferNumber = await this.nextNumber(organizationId);
    const transfer = await this.prisma.stockTransfer.create({
      data: {
        organizationId,
        transferNumber,
        sourceWarehouseId: dto.sourceWarehouseId,
        destWarehouseId: dto.destWarehouseId,
        reference: dto.reference ?? null,
        notes: dto.notes ?? null,
        requestorId: user.userId,
        items: {
          create: dto.items.map((i) => ({
            organizationId,
            productId: i.productId,
            variantId: i.variantId ?? null,
            quantity: i.quantity,
            remarks: i.remarks ?? null,
          })),
        },
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_transfer.created',
      entityType: 'stock_transfer',
      entityId: transfer.id,
      newValue: { transferNumber, source: dto.sourceWarehouseId, dest: dto.destWarehouseId },
    });
    return this.get(organizationId, user, transfer.id);
  }

  async update(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: UpdateTransferDto,
  ): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    this.assertEitherEnd(user, transfer);
    this.assertStatus(transfer, [TransferStatus.DRAFT], 'edited');
    if (dto.items) await this.ensureProducts(organizationId, dto.items);

    await this.prisma.$transaction(async (tx) => {
      await tx.stockTransfer.update({
        where: { id },
        data: {
          ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      if (dto.items) {
        await tx.stockTransferItem.deleteMany({ where: { transferId: id } });
        await tx.stockTransferItem.createMany({
          data: dto.items.map((i) => ({
            transferId: id,
            organizationId,
            productId: i.productId,
            variantId: i.variantId ?? null,
            quantity: i.quantity,
            remarks: i.remarks ?? null,
          })),
        });
      }
    });
    return this.get(organizationId, user, id);
  }

  async submit(organizationId: string, user: RequestUser, id: string): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    this.assertEitherEnd(user, transfer);
    this.assertStatus(transfer, [TransferStatus.DRAFT], 'submitted');
    await this.prisma.stockTransfer.update({ where: { id }, data: { status: TransferStatus.FOR_APPROVAL } });
    return this.get(organizationId, user, id);
  }

  async approve(organizationId: string, user: RequestUser, id: string): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    this.assertEitherEnd(user, transfer);
    this.assertStatus(transfer, [TransferStatus.FOR_APPROVAL], 'approved');
    await this.prisma.stockTransfer.update({
      where: { id },
      data: { status: TransferStatus.APPROVED, approvedById: user.userId },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_transfer.approved',
      entityType: 'stock_transfer',
      entityId: id,
    });
    return this.get(organizationId, user, id);
  }

  async reject(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: RejectTransferDto,
  ): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    this.assertEitherEnd(user, transfer);
    this.assertStatus(transfer, [TransferStatus.FOR_APPROVAL], 'rejected');
    await this.prisma.stockTransfer.update({
      where: { id },
      data: { status: TransferStatus.CANCELLED, notes: dto.reason },
    });
    return this.get(organizationId, user, id);
  }

  /** Dispatch: posts TRANSFER_OUT at the source (on_hand↓, in_transit↑) and captures source WAC. */
  async dispatch(
    organizationId: string,
    user: RequestUser,
    id: string,
    idempotencyKey?: string,
  ): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    if (transfer.status === TransferStatus.IN_TRANSIT) return this.toResponse(transfer);
    await this.warehouses.assertAccess(organizationId, user, transfer.sourceWarehouseId); // source access
    this.assertStatus(transfer, [TransferStatus.APPROVED], 'dispatched');

    const lines = transfer.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
    }));

    const movements = await this.posting.transferDispatch(
      { organizationId, actorId: user.userId, idempotencyKey: idempotencyKey ?? `stock_transfer_dispatch:${id}` },
      { sourceWarehouseId: transfer.sourceWarehouseId, referenceId: transfer.id, lines },
    );
    // movements[i] corresponds to items[i] (one TRANSFER_OUT per line, in order).
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < transfer.items.length; i += 1) {
        const item = transfer.items[i]!;
        const carried = movements[i]?.unitCost ?? new Prisma.Decimal(0);
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { qtyDispatched: item.quantity, dispatchUnitCost: carried },
        });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.IN_TRANSIT, dispatchedById: user.userId, dispatchedAt: new Date() },
      });
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_transfer.dispatched',
      entityType: 'stock_transfer',
      entityId: id,
    });
    return this.get(organizationId, user, id);
  }

  /** Receive: posts TRANSFER_IN (source in_transit↓, dest on_hand↑) at the carried source WAC. */
  async receive(
    organizationId: string,
    user: RequestUser,
    id: string,
    idempotencyKey?: string,
  ): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    if (transfer.status === TransferStatus.RECEIVED) return this.toResponse(transfer);
    await this.warehouses.assertAccess(organizationId, user, transfer.destWarehouseId); // dest access
    this.assertStatus(transfer, [TransferStatus.IN_TRANSIT, TransferStatus.PARTIALLY_RECEIVED], 'received');

    const lines = transfer.items
      .map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        remaining: new Prisma.Decimal(i.qtyDispatched).sub(i.qtyReceived),
        unitCost: i.dispatchUnitCost,
      }))
      .filter((l) => l.remaining.gt(0))
      .map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.remaining, unitCost: l.unitCost }));

    if (lines.length === 0) throw new BadRequestException('Nothing in transit to receive');

    await this.posting.transferReceive(
      { organizationId, actorId: user.userId, idempotencyKey: idempotencyKey ?? `stock_transfer_receive:${id}` },
      {
        sourceWarehouseId: transfer.sourceWarehouseId,
        destWarehouseId: transfer.destWarehouseId,
        referenceId: transfer.id,
        lines,
      },
    );
    await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        await tx.stockTransferItem.update({ where: { id: item.id }, data: { qtyReceived: item.qtyDispatched } });
      }
      await tx.stockTransfer.update({
        where: { id },
        data: { status: TransferStatus.RECEIVED, receivedById: user.userId, receivedAt: new Date() },
      });
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_transfer.received',
      entityType: 'stock_transfer',
      entityId: id,
    });
    return this.get(organizationId, user, id);
  }

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    this.assertEitherEnd(user, transfer);
    const dispatched: TransferStatus[] = [
      TransferStatus.IN_TRANSIT,
      TransferStatus.PARTIALLY_RECEIVED,
      TransferStatus.RECEIVED,
    ];
    if (dispatched.includes(transfer.status)) {
      throw new BadRequestException('A dispatched transfer cannot be cancelled; reverse its movements instead');
    }
    await this.prisma.stockTransfer.update({ where: { id }, data: { status: TransferStatus.CANCELLED } });
    return this.get(organizationId, user, id);
  }

  // ---- helpers ----

  private assertEitherEnd(user: RequestUser, transfer: TransferWithItems): void {
    const allowed =
      isWarehouseAllowed(user, transfer.sourceWarehouseId) ||
      isWarehouseAllowed(user, transfer.destWarehouseId);
    if (!allowed) throw new NotFoundException('Stock transfer not found');
  }

  private assertStatus(transfer: TransferWithItems, allowed: TransferStatus[], verb: string): void {
    if (!allowed.includes(transfer.status)) {
      throw new BadRequestException(`A ${transfer.status} transfer cannot be ${verb}`);
    }
  }

  private async ensureProducts(organizationId: string, items: TransferItemInputDto[]): Promise<void> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const found = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new BadRequestException('One or more products not found');
  }

  private async nextNumber(organizationId: string): Promise<string> {
    const seq = await this.prisma.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'stock_transfer' } },
      create: { organizationId, key: 'stock_transfer', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `TR-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, id: string): Promise<TransferWithItems> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId },
      include: {
        sourceWarehouse: { select: { code: true } },
        destWarehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
    });
    if (!transfer) throw new NotFoundException('Stock transfer not found');
    return transfer;
  }

  private toResponse(t: TransferWithItems): TransferResponse {
    return {
      id: t.id,
      transferNumber: t.transferNumber,
      sourceWarehouseId: t.sourceWarehouseId,
      sourceWarehouseCode: t.sourceWarehouse.code,
      destWarehouseId: t.destWarehouseId,
      destWarehouseCode: t.destWarehouse.code,
      reference: t.reference,
      status: t.status,
      notes: t.notes,
      requestorId: t.requestorId,
      approvedById: t.approvedById,
      dispatchedAt: t.dispatchedAt ? t.dispatchedAt.toISOString() : null,
      receivedAt: t.receivedAt ? t.receivedAt.toISOString() : null,
      createdAt: t.createdAt.toISOString(),
      items: t.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productSku: i.product.sku,
        productName: i.product.name,
        variantId: i.variantId,
        quantity: i.quantity.toString(),
        qtyDispatched: i.qtyDispatched.toString(),
        qtyReceived: i.qtyReceived.toString(),
        remarks: i.remarks,
      })),
    };
  }
}
