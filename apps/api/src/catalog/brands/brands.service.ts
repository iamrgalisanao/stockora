import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import type { BrandResponse } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RequestUser } from '../../common/request-user';
import { assertStatusTransition, statusChangeData } from '../../common/status-lifecycle';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, filter: { q?: string; status?: EntityStatus }): Promise<BrandResponse[]> {
    const brands = await this.prisma.brand.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q ? { name: { contains: filter.q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return brands.map((b) => this.toResponse(b));
  }

  async create(organizationId: string, dto: CreateBrandDto, user: RequestUser): Promise<BrandResponse> {
    try {
      const b = await this.prisma.brand.create({
        data: { organizationId, name: dto.name.trim(), manufacturer: dto.manufacturer?.trim() ?? null },
      });
      await this.audit.record({ organizationId, userId: user.userId, action: 'brand.created', entityType: 'brand', entityId: b.id, newValue: { name: b.name } });
      return this.toResponse(b);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`Brand "${dto.name}" already exists`);
      throw e;
    }
  }

  async update(organizationId: string, id: string, dto: UpdateBrandDto, user: RequestUser): Promise<BrandResponse> {
    const existing = await this.ensureExists(organizationId, id);
    const b = await this.prisma.brand.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.manufacturer !== undefined ? { manufacturer: dto.manufacturer?.trim() ?? null } : {}),
      },
    });
    await this.audit.record({ organizationId, userId: user.userId, action: 'brand.updated', entityType: 'brand', entityId: id, oldValue: { name: existing.name }, newValue: { name: b.name } });
    return this.toResponse(b);
  }

  async changeStatus(organizationId: string, id: string, status: EntityStatus, user: RequestUser): Promise<BrandResponse> {
    const existing = await this.ensureExists(organizationId, id);
    assertStatusTransition(existing.status, status);
    const b = await this.prisma.brand.update({ where: { id }, data: statusChangeData(status, user.userId) });
    await this.audit.record({ organizationId, userId: user.userId, action: 'brand.status_changed', entityType: 'brand', entityId: id, oldValue: { status: existing.status }, newValue: { status } });
    return this.toResponse(b);
  }

  private async ensureExists(organizationId: string, id: string) {
    const b = await this.prisma.brand.findFirst({ where: { id, organizationId } });
    if (!b) throw new NotFoundException('Brand not found');
    return b;
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(b: { id: string; name: string; manufacturer: string | null; status: EntityStatus }): BrandResponse {
    return { id: b.id, name: b.name, manufacturer: b.manufacturer, status: b.status };
  }
}
