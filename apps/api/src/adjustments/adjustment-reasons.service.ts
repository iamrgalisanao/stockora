import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdjustmentReasonResponse } from '@iw/contracts';
import type { AdjustmentReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdjustmentReasonDto, UpdateAdjustmentReasonDto } from './dto/reason.dto';

@Injectable()
export class AdjustmentReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<AdjustmentReasonResponse[]> {
    const rows = await this.prisma.adjustmentReason.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(organizationId: string, dto: CreateAdjustmentReasonDto): Promise<AdjustmentReasonResponse> {
    try {
      const r = await this.prisma.adjustmentReason.create({
        data: {
          organizationId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          requiresEvidence: dto.requiresEvidence ?? false,
        },
      });
      return this.toResponse(r);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`Reason code "${dto.code}" already exists`);
      throw e;
    }
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateAdjustmentReasonDto,
  ): Promise<AdjustmentReasonResponse> {
    const existing = await this.prisma.adjustmentReason.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Adjustment reason not found');
    const r = await this.prisma.adjustmentReason.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.requiresEvidence !== undefined ? { requiresEvidence: dto.requiresEvidence } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.toResponse(r);
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(r: AdjustmentReason): AdjustmentReasonResponse {
    return { id: r.id, code: r.code, name: r.name, requiresEvidence: r.requiresEvidence, isActive: r.isActive };
  }
}
