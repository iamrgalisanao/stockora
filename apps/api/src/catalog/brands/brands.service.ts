import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { BrandResponse } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<BrandResponse[]> {
    const brands = await this.prisma.brand.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return brands.map((b) => this.toResponse(b));
  }

  async create(organizationId: string, dto: CreateBrandDto): Promise<BrandResponse> {
    try {
      const b = await this.prisma.brand.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          manufacturer: dto.manufacturer?.trim() ?? null,
        },
      });
      return this.toResponse(b);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`Brand "${dto.name}" already exists`);
      throw e;
    }
  }

  async update(organizationId: string, id: string, dto: UpdateBrandDto): Promise<BrandResponse> {
    await this.ensureExists(organizationId, id);
    const b = await this.prisma.brand.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.manufacturer !== undefined ? { manufacturer: dto.manufacturer?.trim() ?? null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.toResponse(b);
  }

  private async ensureExists(organizationId: string, id: string): Promise<void> {
    const b = await this.prisma.brand.findFirst({ where: { id, organizationId } });
    if (!b) throw new NotFoundException('Brand not found');
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(b: {
    id: string;
    name: string;
    manufacturer: string | null;
    isActive: boolean;
  }): BrandResponse {
    return { id: b.id, name: b.name, manufacturer: b.manufacturer, isActive: b.isActive };
  }
}
