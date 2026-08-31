import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReleaseStatus } from '@prisma/client';
import type { ReleaseListItem, ReleaseResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from '../warehouses/warehouses.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
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
    items: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
    private readonly posting: InventoryPostingService,
  ) {}

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
    await this.warehouses.assertAccess(organizationId, user, dto.warehouseId);
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
            remarks: i.remarks ?? null,
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
  ): Promise<ReleaseResponse> {
    const release = await this.load(organizationId, id);
    await this.warehouses.assertAccess(organizationId, user, release.warehouseId);
    if (release.status === ReleaseStatus.RELEASED) return this.toResponse(release);
    // Approval is mandatory before posting (product decision).
    this.assertStatus(release, [ReleaseStatus.APPROVED], 'released');

    const lines = release.items
      .filter((i) => new Prisma.Decimal(i.approvedQty).gt(0))
      .map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.approvedQty,
        locationId: i.locationId,
      }));
    if (lines.length === 0) throw new BadRequestException('No approved quantities to release');

    await this.posting.release(
      {
        organizationId,
        actorId: user.userId,
        idempotencyKey: idempotencyKey ?? `stock_release:${release.id}`,
      },
      { warehouseId: release.warehouseId, referenceType: 'stock_release', referenceId: release.id, lines },
    );

    await this.prisma.$transaction(async (tx) => {
      for (const item of release.items) {
        await tx.stockReleaseItem.update({ where: { id: item.id }, data: { releasedQty: item.approvedQty } });
      }
      await tx.stockRelease.update({
        where: { id },
        data: { status: ReleaseStatus.RELEASED, releasedById: user.userId, postedAt: new Date() },
      });
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'stock_release.posted',
      entityType: 'stock_release',
      entityId: id,
      newValue: { lines: lines.length },
    });
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
        items: { include: { product: { select: { sku: true, name: true } } } },
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
        remarks: i.remarks,
      })),
    };
  }
}
