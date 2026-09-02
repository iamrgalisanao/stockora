import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSIONS } from '@iw/contracts';
import type { ProductResponse, VariantResponse } from '@iw/contracts';
import { Prisma, EntityStatus, Product, ProductVariant, ProductBarcode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RequestUser } from '../../common/request-user';
import { assertStatusTransition, statusChangeData } from '../../common/status-lifecycle';
import {
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';

type ProductWithRefs = Product & {
  category: { name: string } | null;
  brand: { name: string } | null;
  baseUom: { code: string };
  variants?: ProductVariant[];
  barcodes?: ProductBarcode[];
};

// Non-terminal document statuses that block archiving a referenced product.
const OPEN_RECEIPTS: string[] = ['DRAFT', 'RECEIVING', 'FOR_INSPECTION', 'PARTIALLY_RECEIVED'];
const OPEN_RELEASES: string[] = ['DRAFT', 'FOR_APPROVAL', 'APPROVED'];
const OPEN_TRANSFERS: string[] = ['DRAFT', 'FOR_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'];
const OPEN_ADJUSTMENTS: string[] = ['DRAFT', 'SUBMITTED', 'PENDING_SECOND_APPROVAL', 'APPROVED'];
const OPEN_COUNTS: string[] = ['COUNTING', 'REVIEW', 'APPROVED'];

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private canViewCost(user: RequestUser): boolean {
    return user.permissions.includes(PERMISSIONS.COST_VIEW);
  }

  async list(organizationId: string, user: RequestUser, status?: EntityStatus): Promise<ProductResponse[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: { category: true, brand: true, baseUom: true },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => this.toResponse(p, this.canViewCost(user)));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: {
        category: true,
        brand: true,
        baseUom: true,
        variants: { orderBy: { sku: 'asc' } },
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { code: 'asc' }] },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.toResponse(product, this.canViewCost(user), true);
  }

  async create(organizationId: string, dto: CreateProductDto, user: RequestUser): Promise<ProductResponse> {
    await this.validateRefs(organizationId, dto);
    await this.assertSkuFree(organizationId, dto.sku);
    let created: ProductWithRefs;
    try {
      created = await this.prisma.product.create({
        data: { organizationId, sku: dto.sku.trim(), name: dto.name.trim(), baseUomId: dto.baseUomId, ...this.optionalData(dto) },
        include: { category: true, brand: true, baseUom: true },
      });
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`SKU "${dto.sku}" already exists`);
      throw e;
    }
    await this.audit.record({ organizationId, userId: user.userId, action: 'product.created', entityType: 'product', entityId: created.id, newValue: { sku: created.sku, name: created.name } });
    return this.toResponse(created, this.canViewCost(user));
  }

  async update(organizationId: string, id: string, dto: UpdateProductDto, user: RequestUser): Promise<ProductResponse> {
    const existing = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Product not found');
    await this.validateRefs(organizationId, dto);
    if (dto.sku && dto.sku.trim() !== existing.sku) await this.assertSkuFree(organizationId, dto.sku, id);

    // Inventory-significant fields become immutable once movements exist (ADR 0003).
    const changesTracking =
      (dto.baseUomId !== undefined && dto.baseUomId !== existing.baseUomId) ||
      (dto.isSerialized !== undefined && dto.isSerialized !== existing.isSerialized) ||
      (dto.isBatchTracked !== undefined && dto.isBatchTracked !== existing.isBatchTracked);
    if (changesTracking) {
      const movements = await this.prisma.inventoryMovement.count({ where: { organizationId, productId: id } });
      if (movements > 0) {
        throw new BadRequestException('Base unit and batch/serial tracking cannot be changed once inventory movements exist');
      }
    }

    let updated: ProductWithRefs;
    try {
      updated = await this.prisma.product.update({
        where: { id },
        data: {
          ...(dto.sku !== undefined ? { sku: dto.sku.trim() } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.baseUomId !== undefined ? { baseUomId: dto.baseUomId } : {}),
          ...this.optionalData(dto),
        },
        include: { category: true, brand: true, baseUom: true },
      });
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`SKU "${dto.sku}" already exists`);
      throw e;
    }
    await this.audit.record({ organizationId, userId: user.userId, action: 'product.updated', entityType: 'product', entityId: id, newValue: { sku: updated.sku } });
    return this.toResponse(updated, this.canViewCost(user));
  }

  async changeStatus(organizationId: string, id: string, status: EntityStatus, user: RequestUser): Promise<ProductResponse> {
    const existing = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Product not found');
    assertStatusTransition(existing.status, status);

    if (status === 'ACTIVE' && existing.hasVariants) {
      const activeVariants = await this.prisma.productVariant.count({ where: { organizationId, productId: id, status: 'ACTIVE' } });
      if (activeVariants === 0) throw new BadRequestException('Cannot activate a product with variants until at least one variant is ACTIVE');
    }
    if (status === 'ARCHIVED') {
      const check = await this.canArchiveProduct(organizationId, id);
      if (!check.canArchive) throw new BadRequestException(`Cannot archive: ${check.reasons.join('; ')}`);
    }
    await this.prisma.product.update({ where: { id }, data: statusChangeData(status, user.userId) });
    await this.audit.record({ organizationId, userId: user.userId, action: 'product.status_changed', entityType: 'product', entityId: id, oldValue: { status: existing.status }, newValue: { status } });
    return this.get(organizationId, user, id);
  }

  /** Reusable archive-eligibility check: no inventory exposure and no open document references. */
  async canArchiveProduct(organizationId: string, productId: string): Promise<{ canArchive: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const bal = await this.prisma.inventoryBalance.aggregate({
      where: { organizationId, productId },
      _sum: { onHand: true, reserved: true, inTransit: true, quarantined: true, damaged: true },
    });
    const s = bal._sum;
    const nonZero = [s.onHand, s.reserved, s.inTransit, s.quarantined, s.damaged].some((v) => v !== null && !new Prisma.Decimal(v).isZero());
    if (nonZero) reasons.push('product still has inventory (on-hand/reserved/in-transit/quarantined/damaged)');

    const [rc, rl, tr, adj, cnt] = await Promise.all([
      this.prisma.goodsReceiptItem.count({ where: { organizationId, productId, receipt: { status: { in: OPEN_RECEIPTS as never } } } }),
      this.prisma.stockReleaseItem.count({ where: { organizationId, productId, release: { status: { in: OPEN_RELEASES as never } } } }),
      this.prisma.stockTransferItem.count({ where: { organizationId, productId, transfer: { status: { in: OPEN_TRANSFERS as never } } } }),
      this.prisma.stockAdjustmentItem.count({ where: { organizationId, productId, adjustment: { status: { in: OPEN_ADJUSTMENTS as never } } } }),
      this.prisma.stockCountItem.count({ where: { organizationId, productId, count: { status: { in: OPEN_COUNTS as never } } } }),
    ]);
    if (rc + rl + tr + adj + cnt > 0) reasons.push('product is referenced by open documents');
    return { canArchive: reasons.length === 0, reasons };
  }

  // ---- variants ----

  async addVariant(organizationId: string, productId: string, dto: CreateVariantDto, user: RequestUser): Promise<VariantResponse> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException('Product not found');
    await this.assertSkuFree(organizationId, dto.sku);
    const variant = await this.prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.create({
        data: {
          organizationId,
          productId,
          sku: dto.sku.trim(),
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
          cost: dto.cost ?? null,
          sellingPrice: dto.sellingPrice ?? null,
        },
      });
      if (!product.hasVariants) await tx.product.update({ where: { id: productId }, data: { hasVariants: true } });
      return v;
    });
    await this.audit.record({ organizationId, userId: user.userId, action: 'variant.created', entityType: 'variant', entityId: variant.id, newValue: { sku: variant.sku } });
    return this.variantResponse(variant, this.canViewCost(user));
  }

  async updateVariant(organizationId: string, productId: string, variantId: string, dto: UpdateVariantDto, user: RequestUser): Promise<VariantResponse> {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, organizationId } });
    if (!variant) throw new NotFoundException('Variant not found');
    if (dto.sku && dto.sku.trim() !== variant.sku) await this.assertSkuFree(organizationId, dto.sku, undefined, variantId);
    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.sku !== undefined ? { sku: dto.sku.trim() } : {}),
        ...(dto.attributes !== undefined ? { attributes: dto.attributes as Prisma.InputJsonValue } : {}),
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.sellingPrice !== undefined ? { sellingPrice: dto.sellingPrice } : {}),
      },
    });
    return this.variantResponse(updated, this.canViewCost(user));
  }

  async changeVariantStatus(organizationId: string, productId: string, variantId: string, status: EntityStatus, user: RequestUser): Promise<VariantResponse> {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, organizationId } });
    if (!variant) throw new NotFoundException('Variant not found');
    assertStatusTransition(variant.status, status);
    if (status === 'ARCHIVED') {
      const bal = await this.prisma.inventoryBalance.aggregate({
        where: { organizationId, productId, variantId },
        _sum: { onHand: true, reserved: true, inTransit: true, quarantined: true, damaged: true },
      });
      const s = bal._sum;
      if ([s.onHand, s.reserved, s.inTransit, s.quarantined, s.damaged].some((v) => v !== null && !new Prisma.Decimal(v).isZero())) {
        throw new BadRequestException('Cannot archive a variant that still has inventory');
      }
    }
    const updated = await this.prisma.productVariant.update({ where: { id: variantId }, data: statusChangeData(status, user.userId) });
    await this.audit.record({ organizationId, userId: user.userId, action: 'variant.status_changed', entityType: 'variant', entityId: variantId, oldValue: { status: variant.status }, newValue: { status } });
    return this.variantResponse(updated, this.canViewCost(user));
  }

  // ---- helpers ----

  private async assertSkuFree(organizationId: string, sku: string, excludeProductId?: string, excludeVariantId?: string): Promise<void> {
    const trimmed = sku.trim();
    const product = await this.prisma.product.findFirst({ where: { organizationId, sku: trimmed, ...(excludeProductId ? { id: { not: excludeProductId } } : {}) }, select: { id: true } });
    if (product) throw new ConflictException(`SKU "${trimmed}" already exists`);
    const variant = await this.prisma.productVariant.findFirst({ where: { organizationId, sku: trimmed, ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}) }, select: { id: true } });
    if (variant) throw new ConflictException(`SKU "${trimmed}" already exists`);
  }

  private async validateRefs(organizationId: string, dto: CreateProductDto | UpdateProductDto): Promise<void> {
    const checks: Array<Promise<void>> = [];
    if (dto.baseUomId) checks.push(this.ensureUom(organizationId, dto.baseUomId));
    if (dto.purchaseUomId) checks.push(this.ensureUom(organizationId, dto.purchaseUomId));
    if (dto.salesUomId) checks.push(this.ensureUom(organizationId, dto.salesUomId));
    if (dto.categoryId) checks.push(this.ensureRef(organizationId, 'productCategory', dto.categoryId, 'Category'));
    if (dto.brandId) checks.push(this.ensureRef(organizationId, 'brand', dto.brandId, 'Brand'));
    if (dto.preferredSupplierId) checks.push(this.ensureSupplier(organizationId, dto.preferredSupplierId));
    await Promise.all(checks);
  }

  private async ensureUom(organizationId: string, id: string): Promise<void> {
    if (!(await this.prisma.unitOfMeasure.findFirst({ where: { id, organizationId } }))) throw new BadRequestException(`Unit of measure ${id} not found`);
  }
  private async ensureSupplier(organizationId: string, id: string): Promise<void> {
    if (!(await this.prisma.supplier.findFirst({ where: { id, organizationId } }))) throw new BadRequestException(`Supplier ${id} not found`);
  }
  private async ensureRef(organizationId: string, model: 'productCategory' | 'brand', id: string, label: string): Promise<void> {
    const row = model === 'productCategory'
      ? await this.prisma.productCategory.findFirst({ where: { id, organizationId } })
      : await this.prisma.brand.findFirst({ where: { id, organizationId } });
    if (!row) throw new BadRequestException(`${label} ${id} not found`);
  }

  private optionalData(dto: CreateProductDto | UpdateProductDto): Partial<Omit<Prisma.ProductUncheckedCreateInput, 'organizationId' | 'sku' | 'name' | 'baseUomId'>> {
    const d: Record<string, unknown> = {};
    const assign = (k: string, v: unknown) => { if (v !== undefined) d[k] = v; };
    assign('description', dto.description);
    assign('productType', dto.productType);
    assign('categoryId', dto.categoryId);
    assign('brandId', dto.brandId);
    assign('purchaseUomId', dto.purchaseUomId);
    assign('salesUomId', dto.salesUomId);
    assign('cost', dto.cost);
    assign('sellingPrice', dto.sellingPrice);
    assign('taxCategory', dto.taxCategory);
    assign('preferredSupplierId', dto.preferredSupplierId);
    assign('leadTimeDays', dto.leadTimeDays);
    assign('trackInventory', dto.trackInventory);
    assign('allowNegative', dto.allowNegative);
    assign('isSerialized', dto.isSerialized);
    assign('isBatchTracked', dto.isBatchTracked);
    assign('isExpiryTracked', dto.isExpiryTracked);
    assign('imageUrl', dto.imageUrl);
    assign('notes', dto.notes);
    return d as Partial<Omit<Prisma.ProductUncheckedCreateInput, 'organizationId' | 'sku' | 'name' | 'baseUomId'>>;
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(p: ProductWithRefs, canViewCost: boolean, includeDetail = false): ProductResponse {
    const res: ProductResponse = {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      productType: p.productType,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      brandId: p.brandId,
      brandName: p.brand?.name ?? null,
      baseUomId: p.baseUomId,
      baseUomCode: p.baseUom.code,
      purchaseUomId: p.purchaseUomId,
      salesUomId: p.salesUomId,
      sellingPrice: p.sellingPrice.toString(),
      taxCategory: p.taxCategory,
      preferredSupplierId: p.preferredSupplierId,
      leadTimeDays: p.leadTimeDays,
      trackInventory: p.trackInventory,
      allowNegative: p.allowNegative,
      isSerialized: p.isSerialized,
      isBatchTracked: p.isBatchTracked,
      isExpiryTracked: p.isExpiryTracked,
      hasVariants: p.hasVariants,
      status: p.status,
      imageUrl: p.imageUrl,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
    if (canViewCost) res.cost = p.cost.toString();
    if (includeDetail && p.variants) res.variants = p.variants.map((v) => this.variantResponse(v, canViewCost));
    if (includeDetail && p.barcodes) {
      res.barcodes = p.barcodes.map((b) => ({ id: b.id, code: b.code, barcodeType: b.barcodeType, isPrimary: b.isPrimary, status: b.status, variantId: b.variantId }));
    }
    return res;
  }

  private variantResponse(v: ProductVariant, canViewCost: boolean): VariantResponse {
    const res: VariantResponse = {
      id: v.id,
      productId: v.productId,
      sku: v.sku,
      attributes: (v.attributes as Record<string, unknown>) ?? {},
      sellingPrice: v.sellingPrice ? v.sellingPrice.toString() : null,
      status: v.status,
    };
    if (canViewCost) res.cost = v.cost ? v.cost.toString() : null;
    return res;
  }
}
