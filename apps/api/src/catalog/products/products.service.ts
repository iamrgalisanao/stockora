import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSIONS } from '@iw/contracts';
import type { ProductResponse, VariantResponse } from '@iw/contracts';
import type { Prisma, Product, ProductVariant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RequestUser } from '../../common/request-user';
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
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private canViewCost(user: RequestUser): boolean {
    return user.permissions.includes(PERMISSIONS.COST_VIEW);
  }

  async list(organizationId: string, user: RequestUser): Promise<ProductResponse[]> {
    const products = await this.prisma.product.findMany({
      where: { organizationId },
      include: { category: true, brand: true, baseUom: true },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => this.toResponse(p, this.canViewCost(user)));
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: { category: true, brand: true, baseUom: true, variants: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.toResponse(product, this.canViewCost(user), true);
  }

  async create(
    organizationId: string,
    dto: CreateProductDto,
    user: RequestUser,
  ): Promise<ProductResponse> {
    await this.validateRefs(organizationId, dto);
    await this.assertSkuFree(organizationId, dto.sku);

    let created: ProductWithRefs;
    try {
      created = await this.prisma.product.create({
        data: {
          organizationId,
          sku: dto.sku.trim(),
          name: dto.name.trim(),
          baseUomId: dto.baseUomId,
          ...this.optionalData(dto),
        },
        include: { category: true, brand: true, baseUom: true },
      });
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`SKU "${dto.sku}" already exists`);
      throw e;
    }

    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'product.created',
      entityType: 'product',
      entityId: created.id,
      newValue: { sku: created.sku, name: created.name },
    });
    return this.toResponse(created, this.canViewCost(user));
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateProductDto,
    user: RequestUser,
  ): Promise<ProductResponse> {
    const existing = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException('Product not found');

    await this.validateRefs(organizationId, dto);
    if (dto.sku && dto.sku.trim() !== existing.sku) {
      await this.assertSkuFree(organizationId, dto.sku, id);
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

    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      oldValue: { sku: existing.sku, cost: existing.cost.toString() },
      newValue: { sku: updated.sku, cost: updated.cost.toString() },
    });
    return this.toResponse(updated, this.canViewCost(user));
  }

  // ---- variants ----

  async addVariant(
    organizationId: string,
    productId: string,
    dto: CreateVariantDto,
    user: RequestUser,
  ): Promise<VariantResponse> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException('Product not found');
    await this.assertSkuFree(organizationId, dto.sku);

    const variant = await this.prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.create({
        data: {
          organizationId,
          productId,
          sku: dto.sku.trim(),
          barcode: dto.barcode ?? null,
          attributes: (dto.attributes ?? {}) as Prisma.InputJsonValue,
          cost: dto.cost ?? null,
          sellingPrice: dto.sellingPrice ?? null,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      if (!product.hasVariants) {
        await tx.product.update({ where: { id: productId }, data: { hasVariants: true } });
      }
      return v;
    });

    return this.variantResponse(variant, this.canViewCost(user));
  }

  async updateVariant(
    organizationId: string,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
    user: RequestUser,
  ): Promise<VariantResponse> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, organizationId },
    });
    if (!variant) throw new NotFoundException('Variant not found');
    if (dto.sku && dto.sku.trim() !== variant.sku) {
      await this.assertSkuFree(organizationId, dto.sku, undefined, variantId);
    }

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.sku !== undefined ? { sku: dto.sku.trim() } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.attributes !== undefined
          ? { attributes: dto.attributes as Prisma.InputJsonValue }
          : {}),
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.sellingPrice !== undefined ? { sellingPrice: dto.sellingPrice } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.variantResponse(updated, this.canViewCost(user));
  }

  // ---- helpers ----

  /** SKUs are unique per organization across BOTH products and variants. */
  private async assertSkuFree(
    organizationId: string,
    sku: string,
    excludeProductId?: string,
    excludeVariantId?: string,
  ): Promise<void> {
    const trimmed = sku.trim();
    const product = await this.prisma.product.findFirst({
      where: { organizationId, sku: trimmed, ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
      select: { id: true },
    });
    if (product) throw new ConflictException(`SKU "${trimmed}" already exists`);

    const variant = await this.prisma.productVariant.findFirst({
      where: { organizationId, sku: trimmed, ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}) },
      select: { id: true },
    });
    if (variant) throw new ConflictException(`SKU "${trimmed}" already exists`);
  }

  private async validateRefs(
    organizationId: string,
    dto: CreateProductDto | UpdateProductDto,
  ): Promise<void> {
    const checks: Array<Promise<void>> = [];
    if (dto.baseUomId) checks.push(this.ensureUom(organizationId, dto.baseUomId));
    if (dto.purchaseUomId) checks.push(this.ensureUom(organizationId, dto.purchaseUomId));
    if (dto.salesUomId) checks.push(this.ensureUom(organizationId, dto.salesUomId));
    if (dto.categoryId) checks.push(this.ensureRef(organizationId, 'productCategory', dto.categoryId, 'Category'));
    if (dto.brandId) checks.push(this.ensureRef(organizationId, 'brand', dto.brandId, 'Brand'));
    await Promise.all(checks);
  }

  private async ensureUom(organizationId: string, id: string): Promise<void> {
    const u = await this.prisma.unitOfMeasure.findFirst({ where: { id, organizationId } });
    if (!u) throw new BadRequestException(`Unit of measure ${id} not found`);
  }

  private async ensureRef(
    organizationId: string,
    model: 'productCategory' | 'brand',
    id: string,
    label: string,
  ): Promise<void> {
    const row =
      model === 'productCategory'
        ? await this.prisma.productCategory.findFirst({ where: { id, organizationId } })
        : await this.prisma.brand.findFirst({ where: { id, organizationId } });
    if (!row) throw new BadRequestException(`${label} ${id} not found`);
  }

  private optionalData(
    dto: CreateProductDto | UpdateProductDto,
  ): Partial<Omit<Prisma.ProductUncheckedCreateInput, 'organizationId' | 'sku' | 'name' | 'baseUomId'>> {
    const d: Record<string, unknown> = {};
    const assign = (k: string, v: unknown) => {
      if (v !== undefined) d[k] = v;
    };
    assign('barcode', dto.barcode);
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
    assign('minStock', dto.minStock);
    assign('maxStock', dto.maxStock);
    assign('reorderPoint', dto.reorderPoint);
    assign('reorderQty', dto.reorderQty);
    assign('leadTimeDays', dto.leadTimeDays);
    assign('trackInventory', dto.trackInventory);
    assign('allowNegative', dto.allowNegative);
    assign('isSerialized', dto.isSerialized);
    assign('isBatchTracked', dto.isBatchTracked);
    assign('isExpiryTracked', dto.isExpiryTracked);
    assign('isActive', dto.isActive);
    assign('imageUrl', dto.imageUrl);
    assign('notes', dto.notes);
    return d as Partial<
      Omit<Prisma.ProductUncheckedCreateInput, 'organizationId' | 'sku' | 'name' | 'baseUomId'>
    >;
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(
    p: ProductWithRefs,
    canViewCost: boolean,
    includeVariants = false,
  ): ProductResponse {
    const res: ProductResponse = {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
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
      minStock: p.minStock.toString(),
      maxStock: p.maxStock.toString(),
      reorderPoint: p.reorderPoint.toString(),
      reorderQty: p.reorderQty.toString(),
      leadTimeDays: p.leadTimeDays,
      trackInventory: p.trackInventory,
      allowNegative: p.allowNegative,
      isSerialized: p.isSerialized,
      isBatchTracked: p.isBatchTracked,
      isExpiryTracked: p.isExpiryTracked,
      hasVariants: p.hasVariants,
      isActive: p.isActive,
      imageUrl: p.imageUrl,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
    if (canViewCost) res.cost = p.cost.toString();
    if (includeVariants && p.variants) {
      res.variants = p.variants.map((v) => this.variantResponse(v, canViewCost));
    }
    return res;
  }

  private variantResponse(v: ProductVariant, canViewCost: boolean): VariantResponse {
    const res: VariantResponse = {
      id: v.id,
      productId: v.productId,
      sku: v.sku,
      barcode: v.barcode,
      attributes: (v.attributes as Record<string, unknown>) ?? {},
      sellingPrice: v.sellingPrice ? v.sellingPrice.toString() : null,
      isActive: v.isActive,
    };
    if (canViewCost) res.cost = v.cost ? v.cost.toString() : null;
    return res;
  }
}
