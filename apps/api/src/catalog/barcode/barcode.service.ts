import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductBarcode } from '@prisma/client';
import type { BarcodeResponse } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RequestUser } from '../../common/request-user';
import { assertStatusTransition } from '../../common/status-lifecycle';
import { CreateBarcodeDto, UpdateBarcodeDto } from './dto/barcode.dto';

@Injectable()
export class BarcodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, productId: string): Promise<BarcodeResponse[]> {
    await this.ensureProduct(organizationId, productId);
    const rows = await this.prisma.productBarcode.findMany({
      where: { organizationId, productId },
      orderBy: [{ isPrimary: 'desc' }, { code: 'asc' }],
    });
    return rows.map((b) => this.toResponse(b));
  }

  async assign(organizationId: string, productId: string, dto: CreateBarcodeDto, user: RequestUser): Promise<BarcodeResponse> {
    await this.ensureProduct(organizationId, productId);
    const variantId = dto.variantId ?? null;
    if (variantId) await this.ensureVariant(organizationId, productId, variantId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (dto.isPrimary) {
          await tx.productBarcode.updateMany({ where: { organizationId, productId, variantId, isPrimary: true }, data: { isPrimary: false } });
        }
        return tx.productBarcode.create({
          data: {
            organizationId,
            productId,
            variantId,
            code: dto.code.trim(),
            barcodeType: dto.barcodeType ?? 'STANDARD',
            isPrimary: dto.isPrimary ?? false,
          },
        });
      });
      await this.audit.record({ organizationId, userId: user.userId, action: 'barcode.assigned', entityType: 'product', entityId: productId, newValue: { code: created.code, variantId } });
      return this.toResponse(created);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`Barcode "${dto.code}" is already in use`);
      throw e;
    }
  }

  async update(organizationId: string, productId: string, barcodeId: string, dto: UpdateBarcodeDto, user: RequestUser): Promise<BarcodeResponse> {
    const existing = await this.prisma.productBarcode.findFirst({ where: { id: barcodeId, productId, organizationId } });
    if (!existing) throw new NotFoundException('Barcode not found');
    if (dto.status) assertStatusTransition(existing.status, dto.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.productBarcode.updateMany({
          where: { organizationId, productId, variantId: existing.variantId, isPrimary: true, id: { not: barcodeId } },
          data: { isPrimary: false },
        });
      }
      return tx.productBarcode.update({
        where: { id: barcodeId },
        data: {
          ...(dto.barcodeType !== undefined ? { barcodeType: dto.barcodeType } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
    });
    await this.audit.record({ organizationId, userId: user.userId, action: 'barcode.updated', entityType: 'product', entityId: productId, newValue: { code: updated.code, status: updated.status, isPrimary: updated.isPrimary } });
    return this.toResponse(updated);
  }

  async remove(organizationId: string, productId: string, barcodeId: string, user: RequestUser): Promise<void> {
    const existing = await this.prisma.productBarcode.findFirst({ where: { id: barcodeId, productId, organizationId } });
    if (!existing) throw new NotFoundException('Barcode not found');
    await this.prisma.productBarcode.delete({ where: { id: barcodeId } });
    await this.audit.record({ organizationId, userId: user.userId, action: 'barcode.removed', entityType: 'product', entityId: productId, oldValue: { code: existing.code } });
  }

  private async ensureProduct(organizationId: string, productId: string): Promise<void> {
    if (!(await this.prisma.product.findFirst({ where: { id: productId, organizationId } }))) throw new NotFoundException('Product not found');
  }
  private async ensureVariant(organizationId: string, productId: string, variantId: string): Promise<void> {
    if (!(await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, organizationId } }))) {
      throw new BadRequestException('Variant not found for this product');
    }
  }
  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }
  private toResponse(b: ProductBarcode): BarcodeResponse {
    return { id: b.id, code: b.code, barcodeType: b.barcodeType, isPrimary: b.isPrimary, status: b.status, variantId: b.variantId };
  }
}
