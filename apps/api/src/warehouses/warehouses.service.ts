import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import type { WarehouseLocationResponse, WarehouseResponse, WarehouseType } from '@iw/contracts';
import type { Warehouse, WarehouseLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { isWarehouseAllowed } from '../common/warehouse-scope';
import { assertStatusTransition, statusChangeData } from '../common/status-lifecycle';
import {
  CreateLocationDto,
  CreateWarehouseDto,
  MoveLocationDto,
  UpdateLocationDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';

// "Open" (non-terminal) document statuses — a warehouse/location with any of these is still in use.
const OPEN_RECEIPTS = ['DRAFT', 'RECEIVING', 'FOR_INSPECTION', 'PARTIALLY_RECEIVED'] as const;
const OPEN_RELEASES = ['DRAFT', 'FOR_APPROVAL', 'APPROVED'] as const;
const OPEN_TRANSFERS = ['DRAFT', 'FOR_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] as const;
const OPEN_ADJUSTMENTS = ['DRAFT', 'SUBMITTED', 'PENDING_SECOND_APPROVAL', 'APPROVED'] as const;
const OPEN_COUNTS = ['COUNTING', 'REVIEW', 'APPROVED'] as const;

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    user: RequestUser,
    filter: { q?: string; status?: EntityStatus } = {},
  ): Promise<WarehouseResponse[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: {
        organizationId,
        ...(user.warehouseScope !== null ? { id: { in: user.warehouseScope } } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q
          ? {
              OR: [
                { code: { contains: filter.q, mode: 'insensitive' } },
                { name: { contains: filter.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { manager: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((w) => this.toResponse(w));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<WarehouseResponse> {
    const w = await this.prisma.warehouse.findFirst({
      where: { id, organizationId },
      include: { manager: true },
    });
    // Out-of-scope warehouses are hidden (404) rather than 403, so a scoped user
    // cannot probe which warehouses exist outside their assignment.
    if (!w || !isWarehouseAllowed(user, id)) throw new NotFoundException('Warehouse not found');
    return this.toResponse(w);
  }

  async create(organizationId: string, dto: CreateWarehouseDto, user: RequestUser): Promise<WarehouseResponse> {
    if (dto.managerId) await this.ensureMember(organizationId, dto.managerId);

    try {
      const w = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.warehouse.updateMany({ where: { organizationId }, data: { isDefault: false } });
        }
        return tx.warehouse.create({
          data: {
            organizationId,
            code: dto.code.trim(),
            name: dto.name.trim(),
            type: (dto.type ?? 'MAIN') as WarehouseType,
            address: dto.address ?? null,
            managerId: dto.managerId ?? null,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            isDefault: dto.isDefault ?? false,
            ...(dto.allowReceiving !== undefined ? { allowReceiving: dto.allowReceiving } : {}),
            ...(dto.allowDispatch !== undefined ? { allowDispatch: dto.allowDispatch } : {}),
            notes: dto.notes ?? null,
          },
          include: { manager: true },
        });
      });
      await this.audit.record({
        organizationId, userId: user.userId, action: 'warehouse.created',
        entityType: 'warehouse', entityId: w.id, newValue: { code: w.code, name: w.name },
      });
      return this.toResponse(w);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`Warehouse code "${dto.code}" already exists`);
      throw e;
    }
  }

  async update(
    organizationId: string,
    user: RequestUser,
    id: string,
    dto: UpdateWarehouseDto,
  ): Promise<WarehouseResponse> {
    await this.get(organizationId, user, id); // existence + scope
    if (dto.managerId) await this.ensureMember(organizationId, dto.managerId);

    const w = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.warehouse.updateMany({
          where: { organizationId, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.allowReceiving !== undefined ? { allowReceiving: dto.allowReceiving } : {}),
          ...(dto.allowDispatch !== undefined ? { allowDispatch: dto.allowDispatch } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        include: { manager: true },
      });
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'warehouse.updated',
      entityType: 'warehouse', entityId: id, newValue: { name: w.name },
    });
    return this.toResponse(w);
  }

  async changeStatus(
    organizationId: string,
    user: RequestUser,
    id: string,
    status: EntityStatus,
  ): Promise<WarehouseResponse> {
    const existing = await this.get(organizationId, user, id);
    assertStatusTransition(existing.status, status);
    if (status === 'ARCHIVED') {
      const check = await this.canArchiveWarehouse(organizationId, id);
      if (!check.canArchive) throw new BadRequestException(`Cannot archive: ${check.reasons.join('; ')}`);
    }
    const w = await this.prisma.warehouse.update({
      where: { id },
      data: statusChangeData(status, user.userId),
      include: { manager: true },
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'warehouse.status_changed',
      entityType: 'warehouse', entityId: id, oldValue: { status: existing.status }, newValue: { status },
    });
    return this.toResponse(w);
  }

  /**
   * A warehouse may be archived only when it holds no stock in ANY bucket, has no open
   * operational documents, no ACTIVE inventory policy, and no active child location.
   * (Same "operational eligibility ≠ existence" pattern as CanArchiveProduct.)
   */
  async canArchiveWarehouse(
    organizationId: string,
    warehouseId: string,
  ): Promise<{ canArchive: boolean; reasons: string[] }> {
    const [buckets, receipts, releases, transfers, adjustments, counts, policies, children] = await Promise.all([
      this.prisma.inventoryBalance.aggregate({
        where: { organizationId, warehouseId },
        _sum: { onHand: true, reserved: true, inTransit: true, quarantined: true, damaged: true },
      }),
      this.prisma.goodsReceipt.count({ where: { organizationId, warehouseId, status: { in: [...OPEN_RECEIPTS] } } }),
      this.prisma.stockRelease.count({ where: { organizationId, warehouseId, status: { in: [...OPEN_RELEASES] } } }),
      this.prisma.stockTransfer.count({
        where: {
          organizationId,
          status: { in: [...OPEN_TRANSFERS] },
          OR: [{ sourceWarehouseId: warehouseId }, { destWarehouseId: warehouseId }],
        },
      }),
      this.prisma.stockAdjustment.count({ where: { organizationId, warehouseId, status: { in: [...OPEN_ADJUSTMENTS] } } }),
      this.prisma.stockCount.count({ where: { organizationId, warehouseId, status: { in: [...OPEN_COUNTS] } } }),
      this.prisma.inventoryPolicy.count({ where: { organizationId, warehouseId, status: 'ACTIVE' } }),
      this.prisma.warehouseLocation.count({ where: { organizationId, warehouseId, status: { not: 'ARCHIVED' } } }),
    ]);

    const s = buckets._sum;
    const nonZeroBucket =
      this.nz(s.onHand) || this.nz(s.reserved) || this.nz(s.inTransit) || this.nz(s.quarantined) || this.nz(s.damaged);

    const reasons: string[] = [];
    if (nonZeroBucket) reasons.push('warehouse still holds stock (on_hand/reserved/in_transit/quarantined/damaged)');
    const openDocs = receipts + releases + transfers + adjustments + counts;
    if (openDocs > 0) reasons.push(`${openDocs} open operational document(s)`);
    if (policies > 0) reasons.push(`${policies} active inventory policy(ies)`);
    if (children > 0) reasons.push(`${children} active location(s)`);
    return { canArchive: reasons.length === 0, reasons };
  }

  // ---- locations ----

  async listLocations(
    organizationId: string,
    user: RequestUser,
    warehouseId: string,
  ): Promise<WarehouseLocationResponse[]> {
    await this.get(organizationId, user, warehouseId); // scope check
    const rows = await this.prisma.warehouseLocation.findMany({
      where: { organizationId, warehouseId },
      orderBy: [{ parentId: 'asc' }, { code: 'asc' }],
    });
    return rows.map((l) => this.toLocationResponse(l));
  }

  async createLocation(
    organizationId: string,
    user: RequestUser,
    warehouseId: string,
    dto: CreateLocationDto,
  ): Promise<WarehouseLocationResponse> {
    await this.get(organizationId, user, warehouseId);
    if (dto.parentId) await this.ensureLiveParent(organizationId, warehouseId, dto.parentId);

    try {
      const l = await this.prisma.warehouseLocation.create({
        data: {
          organizationId,
          warehouseId,
          code: dto.code.trim(),
          name: dto.name ?? null,
          type: dto.type ?? null,
          ...(dto.usage !== undefined ? { usage: dto.usage } : {}),
          parentId: dto.parentId ?? null,
          ...(dto.isPickable !== undefined ? { isPickable: dto.isPickable } : {}),
        },
      });
      await this.audit.record({
        organizationId, userId: user.userId, action: 'location.created',
        entityType: 'location', entityId: l.id, newValue: { warehouseId, code: l.code, parentId: l.parentId },
      });
      return this.toLocationResponse(l);
    } catch (e) {
      if (this.isUnique(e)) {
        throw new ConflictException(`Location code "${dto.code}" already exists in this warehouse`);
      }
      throw e;
    }
  }

  async updateLocation(
    organizationId: string,
    user: RequestUser,
    warehouseId: string,
    locationId: string,
    dto: UpdateLocationDto,
  ): Promise<WarehouseLocationResponse> {
    await this.get(organizationId, user, warehouseId);
    await this.ensureLocation(organizationId, warehouseId, locationId);

    const l = await this.prisma.warehouseLocation.update({
      where: { id: locationId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.usage !== undefined ? { usage: dto.usage } : {}),
        ...(dto.isPickable !== undefined ? { isPickable: dto.isPickable } : {}),
      },
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'location.updated',
      entityType: 'location', entityId: locationId,
    });
    return this.toLocationResponse(l);
  }

  /** Reparent a location within the SAME warehouse (warehouseId is immutable). */
  async moveLocation(
    organizationId: string,
    user: RequestUser,
    warehouseId: string,
    locationId: string,
    dto: MoveLocationDto,
  ): Promise<WarehouseLocationResponse> {
    await this.get(organizationId, user, warehouseId);
    const existing = await this.ensureLocation(organizationId, warehouseId, locationId);
    const newParentId = dto.parentId ?? null;

    if (newParentId !== null) {
      if (newParentId === locationId) throw new BadRequestException('A location cannot be its own parent');
      // Parent must live in the SAME warehouse — descendants never cross warehouses.
      await this.ensureLiveParent(organizationId, warehouseId, newParentId);
      await this.assertNoLocationCycle(organizationId, locationId, newParentId);
    }
    if (newParentId === existing.parentId) return this.toLocationResponse(existing);

    const l = await this.prisma.warehouseLocation.update({
      where: { id: locationId },
      data: { parentId: newParentId },
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'location.moved',
      entityType: 'location', entityId: locationId,
      oldValue: { parentId: existing.parentId }, newValue: { parentId: newParentId },
    });
    return this.toLocationResponse(l);
  }

  async changeLocationStatus(
    organizationId: string,
    user: RequestUser,
    warehouseId: string,
    locationId: string,
    status: EntityStatus,
  ): Promise<WarehouseLocationResponse> {
    await this.get(organizationId, user, warehouseId);
    const existing = await this.ensureLocation(organizationId, warehouseId, locationId);
    assertStatusTransition(existing.status, status);
    if (status === 'ARCHIVED') {
      const check = await this.canArchiveLocation(organizationId, warehouseId, locationId);
      if (!check.canArchive) throw new BadRequestException(`Cannot archive: ${check.reasons.join('; ')}`);
    }
    const l = await this.prisma.warehouseLocation.update({
      where: { id: locationId },
      data: { status, statusChangedAt: new Date() },
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'location.status_changed',
      entityType: 'location', entityId: locationId, oldValue: { status: existing.status }, newValue: { status },
    });
    return this.toLocationResponse(l);
  }

  /**
   * A location may be archived only when no inventory movement references it (its stock/history
   * proxy — balances are not location-scoped yet), no open document line references it, and it has
   * no active descendants.
   */
  async canArchiveLocation(
    organizationId: string,
    warehouseId: string,
    locationId: string,
  ): Promise<{ canArchive: boolean; reasons: string[] }> {
    const [movements, receiptLines, releaseLines, adjustmentLines, activeChildren] = await Promise.all([
      this.prisma.inventoryMovement.count({ where: { organizationId, locationId } }),
      this.prisma.goodsReceiptItem.count({
        where: { organizationId, locationId, receipt: { status: { in: [...OPEN_RECEIPTS] } } },
      }),
      this.prisma.stockReleaseItem.count({
        where: { organizationId, locationId, release: { status: { in: [...OPEN_RELEASES] } } },
      }),
      this.prisma.stockAdjustmentItem.count({
        where: { organizationId, locationId, adjustment: { status: { in: [...OPEN_ADJUSTMENTS] } } },
      }),
      this.prisma.warehouseLocation.count({
        where: { organizationId, warehouseId, parentId: locationId, status: { not: 'ARCHIVED' } },
      }),
    ]);
    const reasons: string[] = [];
    if (movements > 0) reasons.push('location is referenced by inventory movements');
    const openLines = receiptLines + releaseLines + adjustmentLines;
    if (openLines > 0) reasons.push(`${openLines} open operational document line(s)`);
    if (activeChildren > 0) reasons.push(`${activeChildren} active child location(s)`);
    return { canArchive: reasons.length === 0, reasons };
  }

  // ---- reusable guards for other domains ----

  /** Public scope-aware existence check reused by other domains (does NOT check status). */
  async assertAccess(organizationId: string, user: RequestUser, warehouseId: string): Promise<void> {
    const w = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId }, select: { id: true } });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (!isWarehouseAllowed(user, warehouseId)) throw new NotFoundException('Warehouse not found');
  }

  /**
   * Access + ACTIVE — the guard for STARTING a new operation. Inactive/archived warehouses
   * remain readable and resolve in historical documents, but cannot be selected for new work.
   */
  async assertSelectableForCreate(organizationId: string, user: RequestUser, warehouseId: string): Promise<void> {
    const w = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId },
      select: { status: true },
    });
    if (!w || !isWarehouseAllowed(user, warehouseId)) throw new NotFoundException('Warehouse not found');
    if (w.status !== 'ACTIVE') throw new BadRequestException('Warehouse is not active and cannot be used for new operations');
  }

  /** A location may be attached to a new operational line only when it is ACTIVE and in the warehouse. */
  async assertLocationSelectable(organizationId: string, warehouseId: string, locationId: string): Promise<void> {
    const l = await this.prisma.warehouseLocation.findFirst({
      where: { id: locationId, warehouseId, organizationId },
      select: { status: true },
    });
    if (!l) throw new BadRequestException('Location not found in this warehouse');
    if (l.status !== 'ACTIVE') throw new BadRequestException('Location is not active and cannot be used for new operations');
  }

  // ---- helpers ----

  private nz(v: unknown): boolean {
    return v != null && !(v as { isZero?: () => boolean }).isZero?.();
  }

  private async ensureMember(organizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
    });
    if (!membership) throw new BadRequestException('Manager must be an active member of the organization');
  }

  private async ensureLocation(
    organizationId: string,
    warehouseId: string,
    locationId: string,
  ): Promise<WarehouseLocation> {
    const loc = await this.prisma.warehouseLocation.findFirst({
      where: { id: locationId, warehouseId, organizationId },
    });
    if (!loc) throw new NotFoundException('Location not found');
    return loc;
  }

  private async ensureLiveParent(
    organizationId: string,
    warehouseId: string,
    parentId: string,
  ): Promise<void> {
    const loc = await this.prisma.warehouseLocation.findFirst({
      where: { id: parentId, warehouseId, organizationId },
      select: { status: true },
    });
    if (!loc) throw new BadRequestException('Parent location not found in this warehouse');
    if (loc.status === 'ARCHIVED') throw new BadRequestException('Parent location is archived');
  }

  private async assertNoLocationCycle(
    organizationId: string,
    id: string,
    candidateParentId: string,
  ): Promise<void> {
    let cursor: string | null = candidateParentId;
    let guard = 0;
    while (cursor && guard < 1000) {
      if (cursor === id) {
        throw new BadRequestException('Cannot move a location under one of its own descendants');
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.warehouseLocation.findFirst({
          where: { id: cursor, organizationId },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
      guard += 1;
    }
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(w: Warehouse & { manager: { name: string } | null }): WarehouseResponse {
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      type: w.type as WarehouseType,
      address: w.address,
      managerId: w.managerId,
      managerName: w.manager?.name ?? null,
      phone: w.phone,
      email: w.email,
      status: w.status,
      isDefault: w.isDefault,
      allowReceiving: w.allowReceiving,
      allowDispatch: w.allowDispatch,
      notes: w.notes,
      createdAt: w.createdAt.toISOString(),
    };
  }

  private toLocationResponse(l: WarehouseLocation): WarehouseLocationResponse {
    return {
      id: l.id,
      warehouseId: l.warehouseId,
      parentId: l.parentId,
      code: l.code,
      name: l.name,
      type: l.type,
      usage: l.usage,
      isPickable: l.isPickable,
      status: l.status,
    };
  }
}
