import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryMovement, MovementType, Prisma, ReceiptStatus } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { ReceiptListItem, ReceiptResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { LotsService } from '../lots/lots.service';
import { SerialsService, type ReceiptCaptureInput } from '../serials/serials.service';
import { NIL_UUID } from '../inventory/inventory.constants';
import { CreateReceiptDto, ReceiptItemInputDto, UpdateReceiptDto } from './dto/receipt.dto';

const POSTABLE: ReceiptStatus[] = [ReceiptStatus.DRAFT, ReceiptStatus.RECEIVING, ReceiptStatus.FOR_INSPECTION];

type ReceiptWithItems = Prisma.GoodsReceiptGetPayload<{
  include: {
    supplier: { select: { companyName: true } };
    warehouse: { select: { code: true } };
    items: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly posting: InventoryPostingService,
    private readonly lots: LotsService,
    private readonly serials: SerialsService,
  ) {}

  async list(organizationId: string, user: RequestUser): Promise<ReceiptListItem[]> {
    const scope = user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;
    const rows = await this.prisma.goodsReceipt.findMany({
      where: { organizationId, ...(scope ? { warehouseId: scope } : {}) },
      include: { supplier: { select: { companyName: true } }, warehouse: { select: { code: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      supplierName: r.supplier?.companyName ?? null,
      warehouseCode: r.warehouse.code,
      status: r.status,
      receivingDate: r.receivingDate.toISOString(),
      lineCount: r._count.items,
    }));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<ReceiptResponse> {
    const receipt = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, receipt.warehouseId);
    return this.toResponse(receipt, user);
  }

  async create(
    organizationId: string,
    user: RequestUser,
    dto: CreateReceiptDto,
  ): Promise<ReceiptResponse> {
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);
    if (dto.supplierId) await this.ensureSupplier(organizationId, dto.supplierId);
    await this.ensureProducts(organizationId, dto.items);
    for (const i of dto.items) {
      if (i.locationId) await this.warehouses.assertLocationSelectable(organizationId, dto.warehouseId, i.locationId);
    }

    const receiptNumber = await this.nextReceiptNumber(organizationId);
    const receipt = await this.prisma.goodsReceipt.create({
      data: {
        organizationId,
        receiptNumber,
        supplierId: dto.supplierId ?? null,
        warehouseId: dto.warehouseId,
        purchaseOrderRef: dto.purchaseOrderRef ?? null,
        deliveryReceiptRef: dto.deliveryReceiptRef ?? null,
        supplierInvoiceRef: dto.supplierInvoiceRef ?? null,
        receivingDate: dto.receivingDate ? new Date(dto.receivingDate) : new Date(),
        orderDate: dto.orderDate ? new Date(dto.orderDate) : null,
        expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
        receivedById: user.userId,
        notes: dto.notes ?? null,
        items: { create: dto.items.map((i) => this.toItemData(organizationId, i)) },
      },
    });

    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'goods_receipt.created',
      entityType: 'goods_receipt',
      entityId: receipt.id,
      entityDisplay: receiptNumber,
      warehouseId: dto.warehouseId,
      newValue: { receiptNumber, warehouseId: dto.warehouseId, lines: dto.items.length },
    });
    return this.get(organizationId, user, receipt.id);
  }

  async update(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: UpdateReceiptDto,
  ): Promise<ReceiptResponse> {
    const receipt = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, receipt.warehouseId);
    if (receipt.status !== ReceiptStatus.DRAFT) {
      throw new BadRequestException('Only draft receipts can be edited');
    }
    if (dto.supplierId) await this.ensureSupplier(organizationId, dto.supplierId);
    if (dto.items) await this.ensureProducts(organizationId, dto.items);

    await this.prisma.$transaction(async (tx) => {
      await tx.goodsReceipt.update({
        where: { id },
        data: {
          ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
          ...(dto.purchaseOrderRef !== undefined ? { purchaseOrderRef: dto.purchaseOrderRef } : {}),
          ...(dto.deliveryReceiptRef !== undefined ? { deliveryReceiptRef: dto.deliveryReceiptRef } : {}),
          ...(dto.supplierInvoiceRef !== undefined ? { supplierInvoiceRef: dto.supplierInvoiceRef } : {}),
          ...(dto.receivingDate !== undefined ? { receivingDate: new Date(dto.receivingDate) } : {}),
          ...(dto.orderDate !== undefined ? { orderDate: dto.orderDate ? new Date(dto.orderDate) : null } : {}),
          ...(dto.expectedDeliveryDate !== undefined ? { expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      if (dto.items) {
        await tx.goodsReceiptItem.deleteMany({ where: { receiptId: id } });
        await tx.goodsReceiptItem.createMany({
          data: dto.items.map((i) => ({ receiptId: id, ...this.toItemData(organizationId, i) })),
        });
      }
    });
    return this.get(organizationId, user, id);
  }

  /** Posts the received quantities to the inventory ledger and closes the receipt. */
  async post(
    organizationId: string,
    user: RequestUser,
    id: string,
    idempotencyKey?: string,
  ): Promise<ReceiptResponse> {
    const receipt = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, receipt.warehouseId);

    // Idempotent: an already-posted receipt returns as-is.
    if (receipt.postedAt) return this.toResponse(receipt, user);
    if (!POSTABLE.includes(receipt.status)) {
      throw new BadRequestException(`A ${receipt.status} receipt cannot be posted`);
    }

    const receivedItems = receipt.items.filter((i) => new Prisma.Decimal(i.receivedQty).gt(0));
    if (receivedItems.length === 0) {
      throw new BadRequestException('No received quantities to post');
    }

    // Product tracking metadata: batch-tracking (ADR 0007) drives lot resolution; serialization + its
    // capture policy (ADR 0012) drives per-unit serial capture.
    const productIds = [...new Set(receivedItems.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, isBatchTracked: true, isSerialized: true },
    });
    const tracked = new Map(products.map((p) => [p.id, p]));
    const policyMap = await this.serials.policyMapFor(organizationId, productIds);

    // Resolve lots for batch-tracked items. A batch-tracked line must carry a lot number (its
    // `batchNumber`); a non-batch line keeps `batchNumber` only as free-text and posts with no lot.
    const lines: Array<{
      productId: string;
      variantId: string | null;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      locationId: string | null;
      lotId: string | null;
    }> = [];
    const captureInputs: ReceiptCaptureInput[] = [];
    receivedItems.forEach((i) => {
      const meta = tracked.get(i.productId);
      const isBatchTracked = meta?.isBatchTracked ?? false;
      captureInputs.push({
        lineRef: lines.length,
        productId: i.productId,
        variantId: i.variantId,
        locationId: i.locationId,
        lotId: null, // set below once the lot is resolved
        isSerialized: meta?.isSerialized ?? false,
        isBatchTracked,
        captureMode: policyMap.get(i.productId)?.captureMode ?? 'RECEIPT',
        requireLotWhenBatchTracked: policyMap.get(i.productId)?.requireLotWhenBatchTracked ?? true,
        receivedQty: new Prisma.Decimal(i.receivedQty),
        serialNumbers: i.serialNumbers ?? [],
      });
      lines.push({ productId: i.productId, variantId: i.variantId, quantity: new Prisma.Decimal(i.receivedQty), unitCost: new Prisma.Decimal(i.unitCost), locationId: i.locationId, lotId: null });
    });

    for (let idx = 0; idx < receivedItems.length; idx++) {
      const i = receivedItems[idx]!;
      if (!(tracked.get(i.productId)?.isBatchTracked ?? false)) continue;
      const lotId = await this.lots.resolveLotId(
        organizationId, user.userId, i.productId, i.variantId ?? NIL_UUID, true,
        { lotNumber: i.batchNumber ?? undefined, expiryDate: i.expiryDate ? i.expiryDate.toISOString() : undefined, supplierId: receipt.supplierId ?? undefined },
        'RECEIPT',
      );
      lines[idx]!.lotId = lotId;
      captureInputs[idx]!.lotId = lotId;
    }

    // Validate ALL serial captures before any physical inventory commits (ADR 0012 §6 — all-or-nothing).
    const prepared = await this.serials.validateReceiptCaptures(organizationId, captureInputs);

    const fullyReceived = receipt.items.every((i) =>
      new Prisma.Decimal(i.receivedQty).gte(new Prisma.Decimal(i.expectedQty)),
    );
    const status = fullyReceived ? ReceiptStatus.COMPLETED : ReceiptStatus.PARTIALLY_RECEIVED;
    const key = idempotencyKey ?? `goods_receipt:${receipt.id}`;

    // Ledger movement + serial registry + receipt close all commit as one transaction. A rollback leaves
    // no serial rows, and each serialized line records ONE quantity movement (not N) with its serials
    // linked via lastMovementId.
    try {
      await this.prisma.$transaction(async (tx) => {
        const movementByLineRef = new Map<number, InventoryMovement>();
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx]!;
          const movement = await this.posting.postLineInTx(
            tx,
            { organizationId, actorId: user.userId, idempotencyKey: idx === 0 ? key : null },
            {
              movementType: MovementType.PURCHASE_RECEIPT,
              warehouseId: receipt.warehouseId,
              referenceType: 'goods_receipt',
              referenceId: receipt.id,
              line,
            },
          );
          movementByLineRef.set(idx, movement);
        }
        await this.serials.createReceiptSerialsInTx(tx, organizationId, receipt.warehouseId, prepared, movementByLineRef);
        await tx.goodsReceipt.update({ where: { id }, data: { status, postedAt: new Date() } });
      });
    } catch (e) {
      // Concurrent double-post: the unique movement idempotency key lost the race — the winner already
      // posted and closed the receipt. Return it as-is.
      if (this.isUniqueViolation(e)) {
        const already = await this.load(organizationId, id);
        if (already.postedAt) return this.toResponse(already, user);
      }
      throw e;
    }

    const serialCount = prepared.reduce((n, c) => n + c.serialNumbers.length, 0);
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'goods_receipt.posted',
      entityType: 'goods_receipt',
      entityId: id,
      newValue: { status, lines: lines.length, serials: serialCount },
    });
    return this.get(organizationId, user, id);
  }

  async cancel(organizationId: string, user: RequestUser, id: string): Promise<ReceiptResponse> {
    const receipt = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, receipt.warehouseId);
    if (receipt.postedAt || receipt.status === ReceiptStatus.COMPLETED) {
      throw new BadRequestException('A posted receipt cannot be cancelled; reverse its movements instead');
    }
    await this.prisma.goodsReceipt.update({ where: { id }, data: { status: ReceiptStatus.CANCELLED } });
    return this.get(organizationId, user, id);
  }

  // ---- helpers ----

  private toItemData(organizationId: string, i: ReceiptItemInputDto) {
    return {
      organizationId,
      productId: i.productId,
      variantId: i.variantId ?? null,
      expectedQty: i.expectedQty ?? 0,
      receivedQty: i.receivedQty ?? 0,
      rejectedQty: i.rejectedQty ?? 0,
      unitCost: i.unitCost ?? 0,
      batchNumber: i.batchNumber ?? null,
      expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
      locationId: i.locationId ?? null,
      remarks: i.remarks ?? null,
      serialNumbers: i.serialNumbers ?? [],
    };
  }

  private isUniqueViolation(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private async ensureSupplier(organizationId: string, supplierId: string): Promise<void> {
    const s = await this.prisma.supplier.findFirst({ where: { id: supplierId, organizationId } });
    if (!s) throw new BadRequestException('Supplier not found');
  }

  private async ensureProducts(organizationId: string, items: ReceiptItemInputDto[]): Promise<void> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const found = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new BadRequestException('One or more products not found');
  }

  private async nextReceiptNumber(organizationId: string): Promise<string> {
    const seq = await this.prisma.numberSequence.upsert({
      where: { organizationId_key: { organizationId, key: 'goods_receipt' } },
      create: { organizationId, key: 'goods_receipt', value: 1 },
      update: { value: { increment: 1 } },
    });
    return `GR-${seq.value.toString().padStart(6, '0')}`;
  }

  private async load(organizationId: string, id: string): Promise<ReceiptWithItems> {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id, organizationId },
      include: {
        supplier: { select: { companyName: true } },
        warehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
    });
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    return receipt;
  }

  private toResponse(r: ReceiptWithItems, user: RequestUser): ReceiptResponse {
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    return {
      id: r.id,
      receiptNumber: r.receiptNumber,
      supplierId: r.supplierId,
      supplierName: r.supplier?.companyName ?? null,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      purchaseOrderRef: r.purchaseOrderRef,
      deliveryReceiptRef: r.deliveryReceiptRef,
      supplierInvoiceRef: r.supplierInvoiceRef,
      receivingDate: r.receivingDate.toISOString(),
      orderDate: r.orderDate ? r.orderDate.toISOString() : null,
      expectedDeliveryDate: r.expectedDeliveryDate ? r.expectedDeliveryDate.toISOString() : null,
      status: r.status,
      notes: r.notes,
      postedAt: r.postedAt ? r.postedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      items: r.items.map((i) => {
        const item = {
          id: i.id,
          productId: i.productId,
          productSku: i.product.sku,
          productName: i.product.name,
          variantId: i.variantId,
          expectedQty: i.expectedQty.toString(),
          receivedQty: i.receivedQty.toString(),
          rejectedQty: i.rejectedQty.toString(),
          batchNumber: i.batchNumber,
          expiryDate: i.expiryDate ? i.expiryDate.toISOString() : null,
          locationId: i.locationId,
          remarks: i.remarks,
          serialNumbers: i.serialNumbers ?? [],
        } as ReceiptResponse['items'][number];
        if (canCost) item.unitCost = i.unitCost.toString();
        return item;
      }),
    };
  }
}
