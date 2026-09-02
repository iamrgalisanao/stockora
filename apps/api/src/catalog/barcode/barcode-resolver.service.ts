import { Injectable, NotFoundException } from '@nestjs/common';
import type { BarcodeResolutionResult } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves a scanned code to a catalog identity — NOT to inventory availability.
 * v1 handles PRODUCT / PRODUCT_VARIANT; later extends to LOT / SERIAL / LOCATION / DOCUMENT
 * without changing this contract. Inactive/archived barcodes, variants, and products do not resolve.
 */
@Injectable()
export class BarcodeResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(organizationId: string, code: string): Promise<BarcodeResolutionResult> {
    const bc = await this.prisma.productBarcode.findFirst({
      where: { organizationId, code, status: 'ACTIVE' },
      include: {
        product: { select: { id: true, sku: true, name: true, status: true } },
        variant: { select: { id: true, sku: true, status: true } },
      },
    });
    if (!bc) throw new NotFoundException(`No active identity for code "${code}"`);
    if (bc.product.status !== 'ACTIVE') throw new NotFoundException('Code belongs to a non-active product');
    if (bc.variantId && bc.variant && bc.variant.status !== 'ACTIVE') {
      throw new NotFoundException('Code belongs to a non-active variant');
    }
    return {
      type: bc.variantId ? 'PRODUCT_VARIANT' : 'PRODUCT',
      entityId: bc.variantId ?? bc.productId,
      productId: bc.productId,
      variantId: bc.variantId,
      displayCode: bc.code,
      status: 'ACTIVE',
      metadata: { sku: bc.variant?.sku ?? bc.product.sku, name: bc.product.name },
    };
  }
}
