import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import type { CategoryResponse } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RequestUser } from '../../common/request-user';
import { assertStatusTransition, statusChangeData } from '../../common/status-lifecycle';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, filter: { q?: string; status?: EntityStatus }): Promise<CategoryResponse[]> {
    const rows = await this.prisma.productCategory.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q ? { name: { contains: filter.q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((c) => this.toResponse(c));
  }

  async create(organizationId: string, dto: CreateCategoryDto, user: RequestUser): Promise<CategoryResponse> {
    if (dto.parentId) await this.ensureExists(organizationId, dto.parentId);
    try {
      const c = await this.prisma.productCategory.create({
        data: { organizationId, name: dto.name.trim(), parentId: dto.parentId ?? null },
      });
      await this.audit.record({ organizationId, userId: user.userId, action: 'category.created', entityType: 'category', entityId: c.id, newValue: { name: c.name } });
      return this.toResponse(c);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException('A sibling category with this name already exists');
      throw e;
    }
  }

  async update(organizationId: string, id: string, dto: UpdateCategoryDto, user: RequestUser): Promise<CategoryResponse> {
    await this.ensureExists(organizationId, id);
    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
      await this.ensureExists(organizationId, dto.parentId);
      await this.assertNoCycle(organizationId, id, dto.parentId);
    }
    try {
      const c = await this.prisma.productCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        },
      });
      await this.audit.record({ organizationId, userId: user.userId, action: 'category.updated', entityType: 'category', entityId: id, newValue: { name: c.name, parentId: c.parentId } });
      return this.toResponse(c);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException('A sibling category with this name already exists');
      throw e;
    }
  }

  async changeStatus(organizationId: string, id: string, status: EntityStatus, user: RequestUser): Promise<CategoryResponse> {
    const existing = await this.ensureExists(organizationId, id);
    assertStatusTransition(existing.status, status);
    const c = await this.prisma.productCategory.update({ where: { id }, data: statusChangeData(status, user.userId) });
    await this.audit.record({ organizationId, userId: user.userId, action: 'category.status_changed', entityType: 'category', entityId: id, oldValue: { status: existing.status }, newValue: { status } });
    return this.toResponse(c);
  }

  private async assertNoCycle(organizationId: string, id: string, candidateParentId: string): Promise<void> {
    let cursor: string | null = candidateParentId;
    let guard = 0;
    while (cursor && guard < 1000) {
      if (cursor === id) throw new BadRequestException('Cannot move a category under one of its own descendants');
      const parent: { parentId: string | null } | null = await this.prisma.productCategory.findFirst({
        where: { id: cursor, organizationId },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
      guard += 1;
    }
  }

  private async ensureExists(organizationId: string, id: string) {
    const c = await this.prisma.productCategory.findFirst({ where: { id, organizationId } });
    if (!c) throw new NotFoundException(`Category ${id} not found`);
    return c;
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(c: { id: string; parentId: string | null; name: string; status: EntityStatus }): CategoryResponse {
    return { id: c.id, parentId: c.parentId, name: c.name, status: c.status };
  }
}
