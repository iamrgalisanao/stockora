import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementType, Prisma, SerialStatus, TransferStatus } from '@prisma/client';
import type { TransferListItem, TransferResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { isWarehouseAllowed } from '../common/warehouse-scope';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CostingService } from '../inventory/costing.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { SerialsService } from '../serials/serials.service';
import { NIL_UUID } from '../inventory/inventory.constants';
import {
  CreateTransferDto,
  RejectTransferDto,
  TransferItemInputDto,
  TransferSerialInputDto,
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
    private readonly costing: CostingService,
    private readonly serials: SerialsService,
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
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.sourceWarehouseId);
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.destWarehouseId);
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
            lotId: i.lotId ?? null,
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
            lotId: i.lotId ?? null,
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
    serialInputs?: TransferSerialInputDto[],
  ): Promise<TransferResponse> {
    const transfer = await this.load(organizationId, id);
    if (transfer.status === TransferStatus.IN_TRANSIT) return this.toResponse(transfer);
    await this.warehouses.assertAccess(organizationId, user, transfer.sourceWarehouseId); // source access
    this.assertStatus(transfer, [TransferStatus.APPROVED], 'dispatched');

    const lines = transfer.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      lotId: i.lotId, // lot identity is preserved across the transfer (ADR 0007)
    }));

    // Serial selection (ADR 0012 §9). Validate the moved serials are IN_STOCK at the source BEFORE posting
    // so a bad serial fails the dispatch before stock changes. A transfer never creates serials.
    const serialByItem = new Map((serialInputs ?? []).map((s) => [s.itemId, s.serialNumbers]));
    const seen = new Set<string>();
    const serialPlan = new Map<string, string[]>();
    for (const item of transfer.items) {
      const meta = await this.serials.serialMetaFor(organizationId, item.productId);
      const provided = serialByItem.get(item.id) ?? [];
      if (!meta.isSerialized) {
        if (provided.length > 0) throw new BadRequestException(`Product is not serialized and cannot carry serial numbers`);
        continue;
      }
      const q = new Prisma.Decimal(item.quantity);
      if (!q.isInteger()) throw new BadRequestException('A serialized product must be transferred in whole units');
      const variantKey = item.variantId ?? NIL_UUID;
      const numbers = this.serials.normalize(provided, item.productId);
      if (numbers.length !== q.toNumber()) throw new BadRequestException(`Expected ${q.toString()} serial(s) for the transfer line, got ${numbers.length}`);
      const rows = await this.prisma.inventorySerial.findMany({
        where: { organizationId, productId: item.productId, variantId: variantKey, serialNumber: { in: numbers } },
      });
      const byNum = new Map(rows.map((r) => [r.serialNumber, r]));
      for (const sn of numbers) {
        const key = `${item.productId}::${variantKey}::${sn}`;
        if (seen.has(key)) throw new BadRequestException(`Serial ${sn} appears on more than one line`);
        seen.add(key);
        const r = byNum.get(sn);
        if (!r) throw new BadRequestException(`Serial ${sn} is not registered for this product`);
        if (r.status !== 'IN_STOCK') throw new BadRequestException(`Serial ${sn} is ${r.status} and cannot be transferred`);
        if (r.currentWarehouseId !== transfer.sourceWarehouseId) throw new BadRequestException(`Serial ${sn} is not at the source warehouse`);
        if (item.lotId && r.lotId !== item.lotId) throw new BadRequestException(`Serial ${sn} does not belong to the line lot`);
      }
      serialPlan.set(item.id, numbers);
    }

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
        const numbers = serialPlan.get(item.id);
        if (numbers && numbers.length > 0) {
          // IN_STOCK → IN_TRANSIT; the in-transit balance is held at the SOURCE, so the serial stays there.
          await this.serials.transitionExistingInTx(tx, organizationId, {
            productId: item.productId, variantKey: item.variantId ?? NIL_UUID, serialNumbers: numbers,
            expectFrom: [SerialStatus.IN_STOCK], to: SerialStatus.IN_TRANSIT,
            requireWarehouseId: transfer.sourceWarehouseId, setLocationId: null, movementId: movements[i]!.id,
          });
          await tx.stockTransferItem.update({ where: { id: item.id }, data: { serialNumbers: numbers } });
        }
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

    const receivable = transfer.items
      .map((i) => ({ item: i, remaining: new Prisma.Decimal(i.qtyDispatched).sub(i.qtyReceived) }))
      .filter((l) => l.remaining.gt(0));
    const dispatchMovements = await this.prisma.inventoryMovement.findMany({
      where: { organizationId, referenceType: 'stock_transfer', referenceId: transfer.id, movementType: MovementType.TRANSFER_OUT },
      orderBy: { postedAt: 'asc' },
    });
    const lines = await Promise.all(receivable.map(async (l, k) => {
      const dispatchMovement = dispatchMovements[k];
      const basis = dispatchMovement
        ? await this.costing.basisFromMovementInTx(this.prisma, organizationId, dispatchMovement.id)
        : [];
      return {
        productId: l.item.productId, variantId: l.item.variantId, quantity: l.remaining,
        unitCost: l.item.dispatchUnitCost, lotId: l.item.lotId,
        ...(basis.length > 0 ? { costBasis: basis } : {}),
      };
    }));

    if (lines.length === 0) throw new BadRequestException('Nothing in transit to receive');

    const movements = await this.posting.transferReceive(
      { organizationId, actorId: user.userId, idempotencyKey: idempotencyKey ?? `stock_transfer_receive:${id}` },
      {
        sourceWarehouseId: transfer.sourceWarehouseId,
        destWarehouseId: transfer.destWarehouseId,
        referenceId: transfer.id,
        lines,
      },
    );
    // transferReceive posts TWO movements per line in order [clearSource, raiseDest]; the destination
    // (raise) movement for receivable line k is movements[2k+1] — link the arriving serials to it.
    await this.prisma.$transaction(async (tx) => {
      for (let k = 0; k < receivable.length; k += 1) {
        const item = receivable[k]!.item;
        // The same serial identities dispatched now arrive — no substitution (validated by the stored set).
        if (item.serialNumbers.length > 0) {
          const destMovement = movements[2 * k + 1] ?? movements[movements.length - 1]!;
          await this.serials.transitionExistingInTx(tx, organizationId, {
            productId: item.productId, variantKey: item.variantId ?? NIL_UUID, serialNumbers: item.serialNumbers,
            expectFrom: [SerialStatus.IN_TRANSIT], to: SerialStatus.IN_STOCK,
            setWarehouseId: transfer.destWarehouseId, setLocationId: null, movementId: destMovement.id,
          });
        }
      }
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
        serialNumbers: i.serialNumbers,
      })),
    };
  }
}
