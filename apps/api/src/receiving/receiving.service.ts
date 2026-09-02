import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReceiptStatus } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { ReceiptListItem, ReceiptResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { LotsService } from '../lots/lots.service';
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

    // Resolve lots for batch-tracked items (ADR 0007). A batch-tracked line must carry a lot number
    // (its `batchNumber`); a non-batch line keeps `batchNumber` only as free-text and posts with no lot.
    const tracked = new Map(
      (await this.prisma.product.findMany({
        where: { id: { in: [...new Set(receivedItems.map((i) => i.productId))] }, organizationId },
        select: { id: true, isBatchTracked: true },
      })).map((p) => [p.id, p.isBatchTracked]),
    );
    const lines = [];
    for (const i of receivedItems) {
      const isBatchTracked = tracked.get(i.productId) ?? false;
      const lotId = isBatchTracked
        ? await this.lots.resolveLotId(
            organizationId, user.userId, i.productId, i.variantId ?? NIL_UUID, true,
            { lotNumber: i.batchNumber ?? undefined, expiryDate: i.expiryDate ? i.expiryDate.toISOString() : undefined, supplierId: receipt.supplierId ?? undefined },
            'RECEIPT',
          )
        : null;
      lines.push({ productId: i.productId, variantId: i.variantId, quantity: i.receivedQty, unitCost: i.unitCost, locationId: i.locationId, lotId });
    }

    await this.posting.receipt(
      {
        organizationId,
        actorId: user.userId,
        // Stable key so re-posting the same receipt never double-counts.
        idempotencyKey: idempotencyKey ?? `goods_receipt:${receipt.id}`,
      },
      { warehouseId: receipt.warehouseId, referenceType: 'goods_receipt', referenceId: receipt.id, lines },
    );

    const fullyReceived = receipt.items.every((i) =>
      new Prisma.Decimal(i.receivedQty).gte(new Prisma.Decimal(i.expectedQty)),
    );
    const status = fullyReceived ? ReceiptStatus.COMPLETED : ReceiptStatus.PARTIALLY_RECEIVED;

    await this.prisma.goodsReceipt.update({
      where: { id },
      data: { status, postedAt: new Date() },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'goods_receipt.posted',
      entityType: 'goods_receipt',
      entityId: id,
      newValue: { status, lines: lines.length },
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
    };
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
        } as ReceiptResponse['items'][number];
        if (canCost) item.unitCost = i.unitCost.toString();
        return item;
      }),
    };
  }
}
