import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import type { UnitConversionResponse, UnitResponse } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RequestUser } from '../../common/request-user';
import { assertStatusTransition, statusChangeData } from '../../common/status-lifecycle';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';
import { CreateUnitConversionDto } from './dto/conversion.dto';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, filter: { q?: string; status?: EntityStatus }): Promise<UnitResponse[]> {
    const units = await this.prisma.unitOfMeasure.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q
          ? { OR: [{ code: { contains: filter.q, mode: 'insensitive' } }, { name: { contains: filter.q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { code: 'asc' },
    });
    return units.map((u) => this.toResponse(u));
  }

  async create(organizationId: string, dto: CreateUnitDto, user: RequestUser): Promise<UnitResponse> {
    try {
      const u = await this.prisma.unitOfMeasure.create({
        data: { organizationId, code: dto.code.trim().toUpperCase(), name: dto.name.trim(), precision: dto.precision ?? 0 },
      });
      await this.audit.record({ organizationId, userId: user.userId, action: 'unit.created', entityType: 'unit', entityId: u.id, newValue: { code: u.code, name: u.name } });
      return this.toResponse(u);
    } catch (e) {
      throw this.translate(e, `Unit code "${dto.code}" already exists`);
    }
  }

  async update(organizationId: string, id: string, dto: UpdateUnitDto, user: RequestUser): Promise<UnitResponse> {
    await this.ensureExists(organizationId, id);
    const u = await this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.precision !== undefined ? { precision: dto.precision } : {}),
      },
    });
    await this.audit.record({ organizationId, userId: user.userId, action: 'unit.updated', entityType: 'unit', entityId: id, newValue: { name: u.name, precision: u.precision } });
    return this.toResponse(u);
  }

  async changeStatus(organizationId: string, id: string, status: EntityStatus, user: RequestUser): Promise<UnitResponse> {
    const existing = await this.ensureExists(organizationId, id);
    assertStatusTransition(existing.status, status);
    const u = await this.prisma.unitOfMeasure.update({ where: { id }, data: statusChangeData(status, user.userId) });
    await this.audit.record({ organizationId, userId: user.userId, action: 'unit.status_changed', entityType: 'unit', entityId: id, oldValue: { status: existing.status }, newValue: { status } });
    return this.toResponse(u);
  }

  // ---- conversions ----

  async listConversions(organizationId: string): Promise<UnitConversionResponse[]> {
    const rows = await this.prisma.unitConversion.findMany({
      where: { organizationId },
      include: { fromUom: true, toUom: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      fromUomId: c.fromUomId,
      fromCode: c.fromUom.code,
      toUomId: c.toUomId,
      toCode: c.toUom.code,
      factor: c.factor.toString(),
    }));
  }

  async createConversion(organizationId: string, dto: CreateUnitConversionDto): Promise<UnitConversionResponse> {
    if (dto.fromUomId === dto.toUomId) throw new BadRequestException('fromUomId and toUomId must differ');
    if (dto.factor <= 0) throw new BadRequestException('factor must be greater than 0');
    await this.ensureExists(organizationId, dto.fromUomId);
    await this.ensureExists(organizationId, dto.toUomId);
    try {
      const c = await this.prisma.unitConversion.create({
        data: { organizationId, fromUomId: dto.fromUomId, toUomId: dto.toUomId, factor: dto.factor },
        include: { fromUom: true, toUom: true },
      });
      return { id: c.id, fromUomId: c.fromUomId, fromCode: c.fromUom.code, toUomId: c.toUomId, toCode: c.toUom.code, factor: c.factor.toString() };
    } catch (e) {
      throw this.translate(e, 'A conversion between these units already exists');
    }
  }

  async deleteConversion(organizationId: string, id: string): Promise<void> {
    const row = await this.prisma.unitConversion.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Conversion not found');
    await this.prisma.unitConversion.delete({ where: { id } });
  }

  private async ensureExists(organizationId: string, id: string) {
    const u = await this.prisma.unitOfMeasure.findFirst({ where: { id, organizationId } });
    if (!u) throw new NotFoundException(`Unit ${id} not found`);
    return u;
  }

  private translate(e: unknown, conflictMessage: string): Error {
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') {
      return new ConflictException(conflictMessage);
    }
    return e instanceof Error ? e : new Error('Unexpected error');
  }

  private toResponse(u: { id: string; code: string; name: string; precision: number; status: EntityStatus }): UnitResponse {
    return { id: u.id, code: u.code, name: u.name, precision: u.precision, status: u.status };
  }
}
