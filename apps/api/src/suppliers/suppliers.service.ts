import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSIONS } from '@iw/contracts';
import type { SupplierProductResponse, SupplierResponse } from '@iw/contracts';
import type { Supplier, SupplierProduct } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import {
  CreateSupplierDto,
  CreateSupplierProductDto,
  UpdateSupplierDto,
  UpdateSupplierProductDto,
} from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<SupplierResponse[]> {
    const rows = await this.prisma.supplier.findMany({
      where: { organizationId },
      orderBy: { companyName: 'asc' },
    });
    return rows.map((s) => this.toResponse(s));
  }

  async get(organizationId: string, id: string): Promise<SupplierResponse> {
    const s = await this.prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!s) throw new NotFoundException('Supplier not found');
    return this.toResponse(s);
  }

  async create(organizationId: string, dto: CreateSupplierDto): Promise<SupplierResponse> {
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
  ): Promise<SupplierResponse> {
    await this.ensureExists(organizationId, id);
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
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    return this.toResponse(s);
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
    const existing = await this.prisma.supplierProduct.findFirst({
      where: { id: supplierProductId, supplierId, organizationId },
    });
    if (!existing) throw new NotFoundException('Supplier-product link not found');

    const row = await this.prisma.supplierProduct.update({
      where: { id: supplierProductId },
      data: {
        ...(dto.supplierSku !== undefined ? { supplierSku: dto.supplierSku } : {}),
        ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
        ...(dto.leadTimeDays !== undefined ? { leadTimeDays: dto.leadTimeDays } : {}),
        ...(dto.minOrderQty !== undefined ? { minOrderQty: dto.minOrderQty } : {}),
        ...(dto.isPreferred !== undefined ? { isPreferred: dto.isPreferred } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { supplier: true, product: true },
    });
    return this.toProductResponse(row, user.permissions.includes(PERMISSIONS.COST_VIEW));
  }

  async removeProduct(
    organizationId: string,
    supplierId: string,
    supplierProductId: string,
  ): Promise<void> {
    const existing = await this.prisma.supplierProduct.findFirst({
      where: { id: supplierProductId, supplierId, organizationId },
    });
    if (!existing) throw new NotFoundException('Supplier-product link not found');
    await this.prisma.supplierProduct.delete({ where: { id: supplierProductId } });
  }

  // ---- helpers ----

  private async ensureExists(organizationId: string, id: string): Promise<void> {
    const s = await this.prisma.supplier.findFirst({ where: { id, organizationId } });
    if (!s) throw new NotFoundException('Supplier not found');
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
      isActive: s.isActive,
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
      isActive: r.isActive,
    };
    if (canViewCost) res.cost = r.cost.toString();
    return res;
  }
}
