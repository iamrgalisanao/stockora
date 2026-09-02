import { Injectable, NotFoundException } from '@nestjs/common';
import type { BarcodeResolutionResult, ScanDiagnosis } from '@iw/contracts';
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

  /**
   * Operator diagnostic (privileged): explains WHY a code does not resolve, instead of a bare
   * "not found". The normal {@link resolve} contract stays identity-only and excludes non-active
   * records — this path is the exception, gated behind product-manage.
   */
  async diagnose(organizationId: string, code: string): Promise<ScanDiagnosis> {
    if (!code) return { code, outcome: 'NOT_FOUND', reason: 'Empty code', result: null };

    // A code is unique per (org, code) in the schema, so more than one match means data corruption.
    const matches = await this.prisma.productBarcode.findMany({
      where: { organizationId, code },
      include: {
        product: { select: { sku: true, name: true, status: true } },
        variant: { select: { sku: true, status: true } },
      },
    });
    if (matches.length === 0) return { code, outcome: 'NOT_FOUND', reason: 'No barcode matches this code', result: null };
    if (matches.length > 1) {
      return { code, outcome: 'AMBIGUOUS', reason: `${matches.length} barcodes share this code`, result: null };
    }

    const bc = matches[0]!;
    if (bc.status !== 'ACTIVE') {
      return { code, outcome: bc.status === 'ARCHIVED' ? 'ARCHIVED' : 'INACTIVE', reason: `Barcode is ${bc.status}`, result: null };
    }
    if (bc.product.status !== 'ACTIVE') {
      return {
        code,
        outcome: bc.product.status === 'ARCHIVED' ? 'ARCHIVED' : 'INACTIVE',
        reason: `Product ${bc.product.sku} is ${bc.product.status}`,
        result: null,
      };
    }
    if (bc.variantId && bc.variant && bc.variant.status !== 'ACTIVE') {
      return {
        code,
        outcome: bc.variant.status === 'ARCHIVED' ? 'ARCHIVED' : 'INACTIVE',
        reason: `Variant ${bc.variant.sku} is ${bc.variant.status}`,
        result: null,
      };
    }
    return {
      code,
      outcome: 'RESOLVED',
      reason: null,
      result: {
        type: bc.variantId ? 'PRODUCT_VARIANT' : 'PRODUCT',
        entityId: bc.variantId ?? bc.productId,
        productId: bc.productId,
        variantId: bc.variantId,
        displayCode: bc.code,
        status: 'ACTIVE',
        metadata: { sku: bc.variant?.sku ?? bc.product.sku, name: bc.product.name },
      },
    };
  }
}
