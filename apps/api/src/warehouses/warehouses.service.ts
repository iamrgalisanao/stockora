import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WarehouseLocationResponse, WarehouseResponse, WarehouseType } from '@iw/contracts';
import type { Warehouse, WarehouseLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { isWarehouseAllowed } from '../common/warehouse-scope';
import {
  CreateLocationDto,
  CreateWarehouseDto,
  UpdateLocationDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, user: RequestUser): Promise<WarehouseResponse[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: {
        organizationId,
        ...(user.warehouseScope !== null ? { id: { in: user.warehouseScope } } : {}),
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

  async create(organizationId: string, dto: CreateWarehouseDto): Promise<WarehouseResponse> {
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
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
        include: { manager: true },
      });
    });
    return this.toResponse(w);
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
    if (dto.parentId) await this.ensureLocationInWarehouse(organizationId, warehouseId, dto.parentId);

    try {
      const l = await this.prisma.warehouseLocation.create({
        data: {
          organizationId,
          warehouseId,
          code: dto.code.trim(),
          name: dto.name ?? null,
          type: dto.type ?? null,
          parentId: dto.parentId ?? null,
          ...(dto.isPickable !== undefined ? { isPickable: dto.isPickable } : {}),
          ...(dto.isReceivingArea !== undefined ? { isReceivingArea: dto.isReceivingArea } : {}),
        },
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
    const existing = await this.prisma.warehouseLocation.findFirst({
      where: { id: locationId, warehouseId, organizationId },
    });
    if (!existing) throw new NotFoundException('Location not found');

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === locationId) {
        throw new BadRequestException('A location cannot be its own parent');
      }
      await this.ensureLocationInWarehouse(organizationId, warehouseId, dto.parentId);
      await this.assertNoLocationCycle(organizationId, locationId, dto.parentId);
    }

    const l = await this.prisma.warehouseLocation.update({
      where: { id: locationId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.isPickable !== undefined ? { isPickable: dto.isPickable } : {}),
        ...(dto.isReceivingArea !== undefined ? { isReceivingArea: dto.isReceivingArea } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.toLocationResponse(l);
  }

  // ---- helpers ----

  /** Public scope-aware existence check reused by other domains later. */
  async assertAccess(organizationId: string, user: RequestUser, warehouseId: string): Promise<void> {
    const w = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId } });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (!isWarehouseAllowed(user, warehouseId)) {
      throw new NotFoundException('Warehouse not found'); // hide existence outside scope
    }
  }

  private async ensureMember(organizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE' },
    });
    if (!membership) throw new BadRequestException('Manager must be an active member of the organization');
  }

  private async ensureLocationInWarehouse(
    organizationId: string,
    warehouseId: string,
    locationId: string,
  ): Promise<void> {
    const loc = await this.prisma.warehouseLocation.findFirst({
      where: { id: locationId, warehouseId, organizationId },
    });
    if (!loc) throw new BadRequestException('Parent location not found in this warehouse');
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
      isPickable: l.isPickable,
      isReceivingArea: l.isReceivingArea,
      isActive: l.isActive,
    };
  }
}
