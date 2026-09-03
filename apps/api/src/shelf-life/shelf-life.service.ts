import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ShelfLifePolicyResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from '../inventory/inventory.constants';
import { UpsertShelfLifePolicyDto } from './dto/shelf-life.dto';

@Injectable()
export class ShelfLifeService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(organizationId: string, productId: string, variantId = NIL_UUID): Promise<ShelfLifePolicyResponse> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { isExpiryTracked: true } });
    if (!product) throw new NotFoundException('Product not found');
    const row = await this.prisma.shelfLifePolicy.findUnique({
      where: { organizationId_productId_variantId: { organizationId, productId, variantId } },
    });
    if (!row) {
      // Implicit defaults when no policy is configured (ADR 0008): expiry seeds from the product flag.
      return {
        productId, variantId: variantId === NIL_UUID ? null : variantId,
        expiryTrackingRequired: product.isExpiryTracked, minimumShelfLifeOnReceiptDays: null,
        expiringSoonDays: null, allocationStrategy: 'MANUAL', configured: false,
      };
    }
    return {
      productId: row.productId, variantId: row.variantId === NIL_UUID ? null : row.variantId,
      expiryTrackingRequired: row.expiryTrackingRequired,
      minimumShelfLifeOnReceiptDays: row.minimumShelfLifeOnReceiptDays,
      expiringSoonDays: row.expiringSoonDays, allocationStrategy: row.allocationStrategy, configured: true,
    };
  }

  async upsert(organizationId: string, user: RequestUser, productId: string, dto: UpsertShelfLifePolicyDto): Promise<ShelfLifePolicyResponse> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const variantId = dto.variantId ?? NIL_UUID;
    if (dto.minimumShelfLifeOnReceiptDays !== undefined && dto.minimumShelfLifeOnReceiptDays !== null && dto.minimumShelfLifeOnReceiptDays < 0) {
      throw new BadRequestException('minimumShelfLifeOnReceiptDays cannot be negative');
    }
    await this.prisma.shelfLifePolicy.upsert({
      where: { organizationId_productId_variantId: { organizationId, productId, variantId } },
      create: {
        organizationId, productId, variantId,
        expiryTrackingRequired: dto.expiryTrackingRequired ?? false,
        minimumShelfLifeOnReceiptDays: dto.minimumShelfLifeOnReceiptDays ?? null,
        expiringSoonDays: dto.expiringSoonDays ?? null,
        allocationStrategy: dto.allocationStrategy ?? 'MANUAL',
      },
      update: {
        ...(dto.expiryTrackingRequired !== undefined ? { expiryTrackingRequired: dto.expiryTrackingRequired } : {}),
        ...(dto.minimumShelfLifeOnReceiptDays !== undefined ? { minimumShelfLifeOnReceiptDays: dto.minimumShelfLifeOnReceiptDays } : {}),
        ...(dto.expiringSoonDays !== undefined ? { expiringSoonDays: dto.expiringSoonDays } : {}),
        ...(dto.allocationStrategy !== undefined ? { allocationStrategy: dto.allocationStrategy } : {}),
      },
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'shelf_life_policy.updated', entityType: 'product',
      entityId: productId, newValue: { ...dto },
    });
    return this.get(organizationId, productId, variantId);
  }
}
