import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CategoryResponse } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<CategoryResponse[]> {
    const rows = await this.prisma.productCategory.findMany({
      where: { organizationId },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((c) => this.toResponse(c));
  }

  async create(organizationId: string, dto: CreateCategoryDto): Promise<CategoryResponse> {
    if (dto.parentId) await this.ensureExists(organizationId, dto.parentId);
    try {
      const c = await this.prisma.productCategory.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          parentId: dto.parentId ?? null,
        },
      });
      return this.toResponse(c);
    } catch (e) {
      if (this.isUnique(e)) {
        throw new ConflictException('A sibling category with this name already exists');
      }
      throw e;
    }
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
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
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return this.toResponse(c);
    } catch (e) {
      if (this.isUnique(e)) {
        throw new ConflictException('A sibling category with this name already exists');
      }
      throw e;
    }
  }

  /** Walks up from candidateParent; if it reaches `id`, the move would create a cycle. */
  private async assertNoCycle(
    organizationId: string,
    id: string,
    candidateParentId: string,
  ): Promise<void> {
    let cursor: string | null = candidateParentId;
    let guard = 0;
    while (cursor && guard < 1000) {
      if (cursor === id) {
        throw new BadRequestException('Cannot move a category under one of its own descendants');
      }
      const parent: { parentId: string | null } | null =
        await this.prisma.productCategory.findFirst({
          where: { id: cursor, organizationId },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
      guard += 1;
    }
  }

  private async ensureExists(organizationId: string, id: string): Promise<void> {
    const c = await this.prisma.productCategory.findFirst({ where: { id, organizationId } });
    if (!c) throw new NotFoundException(`Category ${id} not found`);
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(c: {
    id: string;
    parentId: string | null;
    name: string;
    isActive: boolean;
  }): CategoryResponse {
    return { id: c.id, parentId: c.parentId, name: c.name, isActive: c.isActive };
  }
}
