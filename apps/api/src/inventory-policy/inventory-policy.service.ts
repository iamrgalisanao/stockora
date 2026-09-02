import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityStatus, Prisma } from '@prisma/client';
import type { InventoryPolicyResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { assertStatusTransition } from '../common/status-lifecycle';
import { D, NIL_UUID } from '../inventory/inventory.constants';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';

type PolicyRow = Prisma.InventoryPolicyGetPayload<{
  include: {
    warehouse: { select: { code: true; name: true } };
    product: { select: { sku: true; name: true } };
    preferredSupplier: { select: { companyName: true } };
  };
}>;

@Injectable()
export class InventoryPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForProduct(organizationId: string, user: RequestUser, productId: string): Promise<InventoryPolicyResponse[]> {
    await this.ensureProduct(organizationId, productId);
    const scope = user.warehouseScope;
    const rows = await this.prisma.inventoryPolicy.findMany({
      where: {
        organizationId,
        productId,
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
      },
      include: {
        warehouse: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
        preferredSupplier: { select: { companyName: true } },
      },
      orderBy: [{ warehouse: { code: 'asc' } }, { variantId: 'asc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  /** Warehouse-centric read: every policy governing stock in one warehouse (2A.1E editor tab). */
  async listForWarehouse(organizationId: string, user: RequestUser, warehouseId: string): Promise<InventoryPolicyResponse[]> {
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    const rows = await this.prisma.inventoryPolicy.findMany({
      where: { organizationId, warehouseId },
      include: {
        warehouse: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
        preferredSupplier: { select: { companyName: true } },
      },
      orderBy: [{ product: { sku: 'asc' } }, { variantId: 'asc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(
    organizationId: string,
    user: RequestUser,
    productId: string,
    dto: CreatePolicyDto,
  ): Promise<InventoryPolicyResponse> {
    await this.ensureProduct(organizationId, productId);
    await this.ensureWarehouse(organizationId, user, dto.warehouseId);
    const variantId = await this.resolveVariant(organizationId, productId, dto.variantId);
    if (dto.preferredSupplierId) await this.ensureSupplier(organizationId, dto.preferredSupplierId);

    const minStock = D(dto.minStock ?? 0);
    const reorderPoint = D(dto.reorderPoint ?? 0);
    const reorderQuantity = D(dto.reorderQuantity);
    const maxStock = dto.maxStock === undefined ? null : D(dto.maxStock);
    this.assertThresholds(minStock, reorderPoint, reorderQuantity, maxStock);

    try {
      const row = await this.prisma.inventoryPolicy.create({
        data: {
          organizationId,
          warehouseId: dto.warehouseId,
          productId,
          variantId,
          minStock,
          maxStock,
          reorderPoint,
          reorderQuantity,
          preferredSupplierId: dto.preferredSupplierId ?? null,
        },
        include: {
          warehouse: { select: { code: true, name: true } },
          product: { select: { sku: true, name: true } },
          preferredSupplier: { select: { companyName: true } },
        },
      });
      await this.audit.record({
        organizationId,
        userId: user.userId,
        action: 'inventory_policy.created',
        entityType: 'inventory_policy',
        entityId: row.id,
        newValue: this.snapshot(row),
      });
      return this.toResponse(row);
    } catch (e) {
      if (this.isUnique(e)) {
        throw new ConflictException('A policy already exists for this warehouse and variant');
      }
      throw e;
    }
  }

  async update(
    organizationId: string,
    user: RequestUser,
    policyId: string,
    dto: UpdatePolicyDto,
  ): Promise<InventoryPolicyResponse> {
    const existing = await this.ensurePolicy(organizationId, user, policyId);
    if (dto.preferredSupplierId) await this.ensureSupplier(organizationId, dto.preferredSupplierId);

    const minStock = dto.minStock !== undefined ? D(dto.minStock) : D(existing.minStock);
    const reorderPoint = dto.reorderPoint !== undefined ? D(dto.reorderPoint) : D(existing.reorderPoint);
    const reorderQuantity = dto.reorderQuantity !== undefined ? D(dto.reorderQuantity) : D(existing.reorderQuantity);
    const maxStock =
      dto.maxStock === undefined
        ? existing.maxStock === null
          ? null
          : D(existing.maxStock)
        : dto.maxStock === null
          ? null
          : D(dto.maxStock);
    this.assertThresholds(minStock, reorderPoint, reorderQuantity, maxStock);

    const row = await this.prisma.inventoryPolicy.update({
      where: { id: policyId },
      data: {
        minStock,
        reorderPoint,
        reorderQuantity,
        maxStock,
        ...(dto.preferredSupplierId !== undefined
          ? { preferredSupplierId: dto.preferredSupplierId }
          : {}),
      },
      include: {
        warehouse: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
        preferredSupplier: { select: { companyName: true } },
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'inventory_policy.updated',
      entityType: 'inventory_policy',
      entityId: policyId,
      oldValue: this.snapshot(existing),
      newValue: this.snapshot(row),
    });
    return this.toResponse(row);
  }

  async changeStatus(
    organizationId: string,
    user: RequestUser,
    policyId: string,
    status: EntityStatus,
  ): Promise<InventoryPolicyResponse> {
    const existing = await this.ensurePolicy(organizationId, user, policyId);
    assertStatusTransition(existing.status, status);
    const row = await this.prisma.inventoryPolicy.update({
      where: { id: policyId },
      // The policy model tracks status changes via statusChangedAt + the audit log
      // (no archivedBy column — attribution lives in the audit entry below).
      data: { status, statusChangedAt: new Date() },
      include: {
        warehouse: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
        preferredSupplier: { select: { companyName: true } },
      },
    });
    await this.audit.record({
      organizationId,
      userId: user.userId,
      action: 'inventory_policy.status_changed',
      entityType: 'inventory_policy',
      entityId: policyId,
      oldValue: { status: existing.status },
      newValue: { status },
    });
    return this.toResponse(row);
  }

  // --- helpers -------------------------------------------------------------

  private assertThresholds(
    minStock: Prisma.Decimal,
    reorderPoint: Prisma.Decimal,
    reorderQuantity: Prisma.Decimal,
    maxStock: Prisma.Decimal | null,
  ): void {
    if (minStock.lt(0)) throw new BadRequestException('minStock must be ≥ 0');
    if (reorderPoint.lt(0)) throw new BadRequestException('reorderPoint must be ≥ 0');
    if (reorderQuantity.lte(0)) throw new BadRequestException('reorderQuantity must be > 0');
    if (maxStock !== null) {
      if (maxStock.lt(minStock)) throw new BadRequestException('maxStock must be ≥ minStock');
      if (maxStock.lt(reorderPoint)) throw new BadRequestException('maxStock must be ≥ reorderPoint');
    }
  }

  private async ensureProduct(organizationId: string, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { id: true } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  private async ensureWarehouse(organizationId: string, user: RequestUser, warehouseId: string) {
    const w = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId },
      select: { id: true },
    });
    if (!w) throw new NotFoundException('Warehouse not found');
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    return w;
  }

  private async resolveVariant(
    organizationId: string,
    productId: string,
    variantId?: string,
  ): Promise<string> {
    if (!variantId) return NIL_UUID;
    const v = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, organizationId },
      select: { id: true },
    });
    if (!v) throw new BadRequestException('Variant does not belong to this product');
    return variantId;
  }

  private async ensureSupplier(organizationId: string, supplierId: string) {
    const s = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
      select: { id: true },
    });
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  private async ensurePolicy(organizationId: string, user: RequestUser, policyId: string): Promise<PolicyRow> {
    const row = await this.prisma.inventoryPolicy.findFirst({
      where: { id: policyId, organizationId },
      include: {
        warehouse: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
        preferredSupplier: { select: { companyName: true } },
      },
    });
    if (!row) throw new NotFoundException('Inventory policy not found');
    if (user.warehouseScope !== null && !user.warehouseScope.includes(row.warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    return row;
  }

  private isUnique(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
  }

  private snapshot(r: PolicyRow) {
    return {
      warehouseId: r.warehouseId,
      variantId: r.variantId === NIL_UUID ? null : r.variantId,
      minStock: r.minStock.toString(),
      maxStock: r.maxStock === null ? null : r.maxStock.toString(),
      reorderPoint: r.reorderPoint.toString(),
      reorderQuantity: r.reorderQuantity.toString(),
      preferredSupplierId: r.preferredSupplierId,
      status: r.status,
    };
  }

  private toResponse(r: PolicyRow): InventoryPolicyResponse {
    return {
      id: r.id,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      warehouseName: r.warehouse.name,
      productId: r.productId,
      productSku: r.product.sku,
      productName: r.product.name,
      variantId: r.variantId === NIL_UUID ? null : r.variantId,
      minStock: r.minStock.toString(),
      maxStock: r.maxStock === null ? null : r.maxStock.toString(),
      reorderPoint: r.reorderPoint.toString(),
      reorderQuantity: r.reorderQuantity.toString(),
      preferredSupplierId: r.preferredSupplierId,
      preferredSupplierName: r.preferredSupplier?.companyName ?? null,
      status: r.status,
    };
  }
}
