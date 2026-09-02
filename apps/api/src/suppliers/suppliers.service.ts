import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityStatus } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { SupplierProductResponse, SupplierResponse } from '@iw/contracts';
import type { Supplier, SupplierProduct } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { assertStatusTransition, statusChangeData } from '../common/status-lifecycle';
import {
  CreateSupplierDto,
  CreateSupplierProductDto,
  UpdateSupplierDto,
  UpdateSupplierProductDto,
} from './dto/supplier.dto';

const OPEN_RECEIPT_STATUSES = ['DRAFT', 'RECEIVING', 'FOR_INSPECTION', 'PARTIALLY_RECEIVED'] as const;

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    filter: { q?: string; status?: EntityStatus },
  ): Promise<SupplierResponse[]> {
    const rows = await this.prisma.supplier.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q
          ? {
              OR: [
                { code: { contains: filter.q, mode: 'insensitive' } },
                { companyName: { contains: filter.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { companyName: 'asc' },
    });
    return rows.map((s) => this.toResponse(s));
  }

  async get(organizationId: string, id: string): Promise<SupplierResponse> {
    return this.toResponse(await this.ensureExists(organizationId, id));
  }

  async create(organizationId: string, dto: CreateSupplierDto, user: RequestUser): Promise<SupplierResponse> {
    try {
      const s = await this.prisma.supplier.create({
        data: {
          organizationId,
          code: dto.code.trim(),
          companyName: dto.companyName.trim(),
          contactPerson: dto.contactPerson ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
          taxNumber: dto.taxNumber ?? null,
          paymentTerms: dto.paymentTerms ?? null,
          leadTimeDays: dto.leadTimeDays ?? 0,
          rating: dto.rating ?? null,
          isPreferred: dto.isPreferred ?? false,
          notes: dto.notes ?? null,
        },
      });
      await this.audit.record({
        organizationId,
        userId: user.userId,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: s.id,
        entityDisplay: s.code,
        newValue: { code: s.code, companyName: s.companyName },
      });
      return this.toResponse(s);
    } catch (e) {
      if (this.isUnique(e)) throw new ConflictException(`Supplier code "${dto.code}" already exists`);
      throw e;
    }
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateSupplierDto,
    user: RequestUser,
  ): Promise<SupplierResponse> {
    const existing = await this.ensureExists(organizationId, id);
    const s = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.companyName !== undefined ? { companyName: dto.companyName.trim() } : {}),
        ...(dto.contactPerson !== undefined ? { contactPerson: dto.contactPerson } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.taxNumber !== undefined ? { taxNumber: dto.taxNumber } : {}),
        ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms } : {}),
        ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
        ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
        ...(dto.isPreferred !== undefined ? { isPreferred: dto.isPreferred } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'supplier.updated',
      entityType: 'supplier',
      entityId: id,
      entityDisplay: existing.code,
      oldValue: { companyName: existing.companyName },
      newValue: { companyName: s.companyName },
    });
    return this.toResponse(s);
  }

  async changeStatus(
    organizationId: string,
    id: string,
    status: EntityStatus,
    user: RequestUser,
  ): Promise<SupplierResponse> {
    const existing = await this.ensureExists(organizationId, id);
    assertStatusTransition(existing.status, status);
    if (status === 'ARCHIVED') {
      const check = await this.canArchiveSupplier(organizationId, id);
      if (!check.canArchive) throw new BadRequestException(`Cannot archive: ${check.reasons.join('; ')}`);
    }
    const s = await this.prisma.supplier.update({
      where: { id },
      data: statusChangeData(status, user.userId),
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'supplier.status_changed',
      entityType: 'supplier',
      entityId: id,
      entityDisplay: existing.code,
      oldValue: { status: existing.status },
      newValue: { status },
    });
    return this.toResponse(s);
  }

  /** A supplier cannot be archived while it is still relied upon (preferred, or open receipts). */
  async canArchiveSupplier(
    organizationId: string,
    supplierId: string,
  ): Promise<{ canArchive: boolean; reasons: string[] }> {
    const [preferredProducts, preferredPolicies, openReceipts] = await Promise.all([
      this.prisma.product.count({
        where: { organizationId, preferredSupplierId: supplierId, status: { not: 'ARCHIVED' } },
      }),
      this.prisma.inventoryPolicy.count({
        where: { organizationId, preferredSupplierId: supplierId, status: { not: 'ARCHIVED' } },
      }),
      this.prisma.goodsReceipt.count({
        where: { organizationId, supplierId, status: { in: [...OPEN_RECEIPT_STATUSES] } },
      }),
    ]);
    const reasons: string[] = [];
    if (preferredProducts > 0) reasons.push(`preferred supplier on ${preferredProducts} product(s)`);
    if (preferredPolicies > 0) reasons.push(`preferred supplier on ${preferredPolicies} inventory policy(ies)`);
    if (openReceipts > 0) reasons.push(`referenced by ${openReceipts} open goods receipt(s)`);
    return { canArchive: reasons.length === 0, reasons };
  }

  // ---- supplier products ----

  async listProducts(
    organizationId: string,
    supplierId: string,
    user: RequestUser,
  ): Promise<SupplierProductResponse[]> {
    await this.ensureExists(organizationId, supplierId);
    const rows = await this.prisma.supplierProduct.findMany({
      where: { organizationId, supplierId },
      include: { supplier: true, product: true },
      orderBy: { createdAt: 'asc' },
    });
    const canViewCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    return rows.map((r) => this.toProductResponse(r, canViewCost));
  }

  async addProduct(
    organizationId: string,
    supplierId: string,
    dto: CreateSupplierProductDto,
    user: RequestUser,
  ): Promise<SupplierProductResponse> {
    await this.ensureExists(organizationId, supplierId);
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found in this organization');

    try {
      const row = await this.prisma.supplierProduct.create({
        data: {
          organizationId,
          supplierId,
          productId: dto.productId,
          supplierSku: dto.supplierSku ?? null,
          cost: dto.cost ?? 0,
          leadTimeDays: dto.leadTimeDays ?? null,
          minOrderQty: dto.minOrderQty ?? null,
          isPreferred: dto.isPreferred ?? false,
        },
        include: { supplier: true, product: true },
      });
      await this.audit.record({
        organizationId,
        userId: user.userId,
        action: 'supplier_product.linked',
        entityType: 'supplier_product',
        entityId: row.id,
        newValue: { supplierId, productId: dto.productId },
      });
      return this.toProductResponse(row, user.permissions.includes(PERMISSIONS.COST_VIEW));
    } catch (e) {
      if (this.isUnique(e)) {
        throw new ConflictException('This product is already linked to the supplier');
      }
      throw e;
    }
  }

  async updateProduct(
    organizationId: string,
    supplierId: string,
    supplierProductId: string,
    dto: UpdateSupplierProductDto,
    user: RequestUser,
  ): Promise<SupplierProductResponse> {
    await this.ensureProductLink(organizationId, supplierId, supplierProductId);
    const row = await this.prisma.supplierProduct.update({
      where: { id: supplierProductId },
      data: {
        ...(dto.supplierSku !== undefined ? { supplierSku: dto.supplierSku } : {}),
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
        ...(dto.minOrderQty !== undefined ? { minOrderQty: dto.minOrderQty } : {}),
        ...(dto.isPreferred !== undefined ? { isPreferred: dto.isPreferred } : {}),
      },
      include: { supplier: true, product: true },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'supplier_product.updated',
      entityType: 'supplier_product',
      entityId: supplierProductId,
    });
    return this.toProductResponse(row, user.permissions.includes(PERMISSIONS.COST_VIEW));
  }

  async changeProductStatus(
    organizationId: string,
    supplierId: string,
    supplierProductId: string,
    status: EntityStatus,
    user: RequestUser,
  ): Promise<SupplierProductResponse> {
    const existing = await this.ensureProductLink(organizationId, supplierId, supplierProductId);
    assertStatusTransition(existing.status, status);
    const row = await this.prisma.supplierProduct.update({
      where: { id: supplierProductId },
      data: { status, statusChangedAt: new Date() },
      include: { supplier: true, product: true },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'supplier_product.status_changed',
      entityType: 'supplier_product',
      entityId: supplierProductId,
      oldValue: { status: existing.status },
      newValue: { status },
    });
    return this.toProductResponse(row, user.permissions.includes(PERMISSIONS.COST_VIEW));
  }

  // ---- helpers ----

  private async ensureExists(organizationId: string, id: string): Promise<Supplier> {
    const s = await this.prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  private async ensureProductLink(
    organizationId: string,
    supplierId: string,
    supplierProductId: string,
  ): Promise<SupplierProduct> {
    const existing = await this.prisma.supplierProduct.findFirst({
      where: { id: supplierProductId, supplierId, organizationId },
    });
    if (!existing) throw new NotFoundException('Supplier-product link not found');
    return existing;
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private toResponse(s: Supplier): SupplierResponse {
    return {
      id: s.id,
      code: s.code,
      companyName: s.companyName,
      contactPerson: s.contactPerson,
      email: s.email,
      phone: s.phone,
      address: s.address,
      taxNumber: s.taxNumber,
      paymentTerms: s.paymentTerms,
      leadTimeDays: s.leadTimeDays,
      rating: s.rating,
      isPreferred: s.isPreferred,
      status: s.status,
      notes: s.notes,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private toProductResponse(
    r: SupplierProduct & { supplier: Supplier; product: { sku: string; name: string } },
    canViewCost: boolean,
  ): SupplierProductResponse {
    const res: SupplierProductResponse = {
      id: r.id,
      supplierId: r.supplierId,
      supplierName: r.supplier.companyName,
      productId: r.productId,
      productSku: r.product.sku,
      productName: r.product.name,
      supplierSku: r.supplierSku,
      leadTimeDays: r.leadTimeDays,
      minOrderQty: r.minOrderQty ? r.minOrderQty.toString() : null,
      isPreferred: r.isPreferred,
      status: r.status,
    };
    if (canViewCost) res.cost = r.cost.toString();
    return res;
  }
}
