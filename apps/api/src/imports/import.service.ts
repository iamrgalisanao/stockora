import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ImportRowStatus, ImportType, Prisma } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type { ImportJobResponse, ImportPreviewResponse, ImportRowResponse, PermissionCode } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import type { RequestUser } from '../common/request-user';
import { hashContent, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv } from './csv.util';
import { rowStatus, type ValidatedRow } from './import.types';
import { ProductImportValidator } from './validators/product-import.validator';
import { SupplierImportValidator } from './validators/supplier-import.validator';
import { OpeningInventoryImportValidator } from './validators/opening-inventory-import.validator';

const PERMISSION_FOR: Record<ImportType, PermissionCode> = {
  PRODUCTS: PERMISSIONS.IMPORT_PRODUCTS,
  SUPPLIERS: PERMISSIONS.IMPORT_SUPPLIERS,
  OPENING_INVENTORY: PERMISSIONS.IMPORT_OPENING_INVENTORY,
};

const MAX_PREVIEW_ROWS = 2_000; // cap the rows echoed back; all rows are still staged in the DB

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: InventoryPostingService,
    private readonly productValidator: ProductImportValidator,
    private readonly supplierValidator: SupplierImportValidator,
    private readonly openingValidator: OpeningInventoryImportValidator,
  ) {}

  // ---- preview (staged, zero domain writes) ----

  async preview(
    organizationId: string,
    user: RequestUser,
    type: ImportType,
    upload: { fileName: string; content: string },
  ): Promise<ImportPreviewResponse> {
    const content = upload.content ?? '';
    if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
      throw new BadRequestException(`File exceeds the ${MAX_IMPORT_BYTES / 1_000_000} MB limit`);
    }
    const { records } = parseCsv(content);
    if (records.length === 0) throw new BadRequestException('No data rows found');
    if (records.length > MAX_IMPORT_ROWS) throw new BadRequestException(`File exceeds the ${MAX_IMPORT_ROWS}-row limit`);

    const rows = await this.runValidator(organizationId, user, type, records);
    const counts = this.count(rows);

    const job = await this.prisma.importJob.create({
      data: {
        organizationId,
        type,
        status: 'VALIDATED',
        sourceFileName: (upload.fileName ?? 'import.csv').slice(0, 200),
        fileHash: hashContent(content),
        totalRows: rows.length,
        validRows: counts.valid,
        invalidRows: counts.invalid,
        warningRows: counts.warning,
        correlationId: randomUUID(),
        createdById: user.userId,
        rows: {
          create: rows.map((r) => ({
            rowNumber: r.rowNumber,
            rawData: r.raw as Prisma.InputJsonValue,
            normalizedData: (r.normalized ?? undefined) as Prisma.InputJsonValue | undefined,
            status: rowStatus(r) as ImportRowStatus,
            errors: r.errors as Prisma.InputJsonValue,
            warnings: r.warnings as Prisma.InputJsonValue,
          })),
        },
      },
    });

    return { job: this.toJobResponse(job), rows: rows.slice(0, MAX_PREVIEW_ROWS).map((r) => this.toRowResponse(r)) };
  }

  async getJob(organizationId: string, user: RequestUser, jobId: string): Promise<ImportPreviewResponse> {
    const job = await this.loadJob(organizationId, jobId);
    this.assertTypePermission(user, job.type);
    const rows = await this.prisma.importRow.findMany({
      where: { jobId },
      orderBy: { rowNumber: 'asc' },
      take: MAX_PREVIEW_ROWS,
    });
    return {
      job: this.toJobResponse(job),
      rows: rows.map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        rawData: r.rawData as Record<string, string>,
        normalizedData: (r.normalizedData ?? null) as Record<string, unknown> | null,
        errors: (r.errors ?? []) as string[],
        warnings: (r.warnings ?? []) as string[],
      })),
    };
  }

  // ---- commit (all-or-nothing; only already-validated staged data) ----

  async commit(organizationId: string, user: RequestUser, jobId: string): Promise<ImportJobResponse> {
    const job = await this.loadJob(organizationId, jobId);
    this.assertTypePermission(user, job.type);

    if (job.status === 'COMPLETED') throw new BadRequestException('This import has already been committed');
    if (job.status === 'COMMITTING') throw new ConflictException('This import is already being committed');
    if (job.status !== 'VALIDATED') throw new BadRequestException(`An import in ${job.status} cannot be committed`);
    if (job.invalidRows > 0) throw new BadRequestException(`Fix ${job.invalidRows} invalid row(s) before committing`);

    // Optimistic lock — flip VALIDATED -> COMMITTING once; a racing second commit sees 0 rows updated.
    const locked = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: 'VALIDATED' },
      data: { status: 'COMMITTING' },
    });
    if (locked.count === 0) throw new ConflictException('This import is already being committed');

    const rows = await this.prisma.importRow.findMany({ where: { jobId, status: { not: 'INVALID' } }, orderBy: { rowNumber: 'asc' } });
    const data = rows.map((r) => r.normalizedData as Record<string, unknown>);

    try {
      if (job.type === 'PRODUCTS') await this.commitProducts(organizationId, user, job.correlationId, data);
      else if (job.type === 'SUPPLIERS') await this.commitSuppliers(organizationId, user, job.correlationId, data);
      else await this.commitOpeningInventory(organizationId, user, job.correlationId, jobId, data);

      const done = await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', committedAt: new Date() },
      });
      return this.toJobResponse(done);
    } catch (e) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: e instanceof Error ? e.message.slice(0, 500) : 'Commit failed' },
      });
      throw e;
    }
  }

  // ---- committers ----

  private async commitProducts(organizationId: string, user: RequestUser, correlationId: string, data: Array<Record<string, unknown>>) {
    const productRows = data.filter((d) => d.kind === 'product');
    const variantRows = data.filter((d) => d.kind === 'variant');

    // Parent product ids: the ones created here plus any pre-existing ones referenced by variants.
    const created: Array<{ action: string; entityType: string; entityId: string; display: string; warehouseId?: null }> = [];

    await this.prisma.$transaction(async (tx) => {
      const skuToId = new Map<string, string>();
      for (const p of productRows) {
        const row = await tx.product.create({
          data: {
            organizationId,
            sku: String(p.sku),
            name: String(p.name),
            description: (p.description as string | null) ?? null,
            baseUomId: String(p.baseUomId),
            categoryId: (p.categoryId as string | null) ?? null,
            brandId: (p.brandId as string | null) ?? null,
            cost: p.cost == null ? undefined : new Prisma.Decimal(p.cost as number),
            sellingPrice: p.sellingPrice == null ? undefined : new Prisma.Decimal(p.sellingPrice as number),
            isSerialized: Boolean(p.isSerialized),
            isBatchTracked: Boolean(p.isBatchTracked),
            status: p.status as never,
          },
        });
        skuToId.set(row.sku, row.id);
        created.push({ action: 'product.created', entityType: 'product', entityId: row.id, display: row.sku });
        if (p.barcode) {
          await tx.productBarcode.create({ data: { organizationId, productId: row.id, code: String(p.barcode) } });
          created.push({ action: 'barcode.assigned', entityType: 'barcode', entityId: row.id, display: String(p.barcode) });
        }
      }
      // Resolve variant parents (in-file first, then DB).
      const missingParents = [...new Set(variantRows.map((v) => String(v.parentSku)).filter((s) => !skuToId.has(s)))];
      if (missingParents.length) {
        const dbParents = await tx.product.findMany({ where: { organizationId, sku: { in: missingParents } }, select: { id: true, sku: true } });
        dbParents.forEach((p) => skuToId.set(p.sku, p.id));
      }
      for (const v of variantRows) {
        const productId = skuToId.get(String(v.parentSku));
        if (!productId) throw new BadRequestException(`Parent product "${v.parentSku}" not found at commit`);
        const row = await tx.productVariant.create({
          data: {
            organizationId,
            productId,
            sku: String(v.sku),
            cost: v.cost == null ? undefined : new Prisma.Decimal(v.cost as number),
            sellingPrice: v.sellingPrice == null ? undefined : new Prisma.Decimal(v.sellingPrice as number),
            status: v.status as never,
          },
        });
        // A product with any variant is flagged hasVariants.
        await tx.product.update({ where: { id: productId }, data: { hasVariants: true } });
        created.push({ action: 'variant.created', entityType: 'variant', entityId: row.id, display: row.sku });
        if (v.barcode) {
          await tx.productBarcode.create({ data: { organizationId, productId, variantId: row.id, code: String(v.barcode) } });
          created.push({ action: 'barcode.assigned', entityType: 'barcode', entityId: row.id, display: String(v.barcode) });
        }
      }
    });

    for (const c of created) {
      await this.audit.record({
        organizationId, userId: user.userId, source: 'IMPORT', correlationId,
        action: c.action, entityType: c.entityType, entityId: c.entityId, entityDisplay: c.display,
      });
    }
  }

  private async commitSuppliers(organizationId: string, user: RequestUser, correlationId: string, data: Array<Record<string, unknown>>) {
    const supplierRows = data.filter((d) => d.kind === 'supplier');
    const linkRows = data.filter((d) => d.kind === 'link');
    const created: Array<{ action: string; entityType: string; entityId: string; display: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      const codeToId = new Map<string, string>();
      for (const s of supplierRows) {
        const row = await tx.supplier.create({
          data: {
            organizationId,
            code: String(s.code),
            companyName: String(s.companyName),
            contactPerson: (s.contactPerson as string | null) ?? null,
            email: (s.email as string | null) ?? null,
            phone: (s.phone as string | null) ?? null,
            leadTimeDays: Number(s.leadTimeDays ?? 0),
          },
        });
        codeToId.set(row.code, row.id);
        created.push({ action: 'supplier.created', entityType: 'supplier', entityId: row.id, display: row.code });
      }
      const missing = [...new Set(linkRows.map((l) => String(l.supplierCode)).filter((c) => !codeToId.has(c)))];
      if (missing.length) {
        const dbSup = await tx.supplier.findMany({ where: { organizationId, code: { in: missing } }, select: { id: true, code: true } });
        dbSup.forEach((s) => codeToId.set(s.code, s.id));
      }
      const skus = [...new Set(linkRows.map((l) => String(l.productSku)))];
      const products = skus.length
        ? await tx.product.findMany({ where: { organizationId, sku: { in: skus } }, select: { id: true, sku: true } })
        : [];
      const skuToId = new Map(products.map((p) => [p.sku, p.id]));
      for (const l of linkRows) {
        const supplierId = codeToId.get(String(l.supplierCode));
        const productId = skuToId.get(String(l.productSku));
        if (!supplierId || !productId) throw new BadRequestException('Supplier or product not found at commit');
        const row = await tx.supplierProduct.create({
          data: {
            organizationId, supplierId, productId,
            supplierSku: (l.supplierSku as string | null) ?? null,
            cost: new Prisma.Decimal((l.cost as number) ?? 0),
            minOrderQty: l.minOrderQty == null ? null : new Prisma.Decimal(l.minOrderQty as number),
          },
        });
        created.push({ action: 'supplier_product.linked', entityType: 'supplier_product', entityId: row.id, display: `${l.supplierCode}→${l.productSku}` });
      }
    });

    for (const c of created) {
      await this.audit.record({
        organizationId, userId: user.userId, source: 'IMPORT', correlationId,
        action: c.action, entityType: c.entityType, entityId: c.entityId, entityDisplay: c.display,
      });
    }
  }

  /** Opening inventory posts THROUGH the ledger (never a direct balance write), grouped per warehouse. */
  private async commitOpeningInventory(
    organizationId: string,
    user: RequestUser,
    correlationId: string,
    jobId: string,
    data: Array<Record<string, unknown>>,
  ) {
    const byWarehouse = new Map<string, Array<Record<string, unknown>>>();
    for (const d of data) {
      const w = String(d.warehouseId);
      (byWarehouse.get(w) ?? byWarehouse.set(w, []).get(w)!).push(d);
    }
    for (const [warehouseId, lines] of byWarehouse) {
      await this.posting.openingBalance(
        {
          organizationId,
          actorId: user.userId,
          // Stable per (job, warehouse) so a re-run never double-posts (idempotent).
          idempotencyKey: `import:${jobId}:${warehouseId}`,
          reason: 'Bulk opening-inventory import',
        },
        {
          warehouseId,
          lines: lines.map((l) => ({
            productId: String(l.productId),
            variantId: (l.variantId as string | null) ?? null,
            quantity: l.quantity as number,
            unitCost: l.unitCost as number,
            locationId: (l.locationId as string | null) ?? null,
          })),
        },
      );
      await this.audit.record({
        organizationId, userId: user.userId, source: 'IMPORT', correlationId,
        action: 'opening_inventory.posted', entityType: 'warehouse', entityId: warehouseId, warehouseId,
        newValue: { lines: lines.length },
      });
    }
  }

  // ---- helpers ----

  private runValidator(organizationId: string, user: RequestUser, type: ImportType, records: Array<Record<string, string>>): Promise<ValidatedRow[]> {
    if (type === 'PRODUCTS') return this.productValidator.validate(organizationId, records);
    if (type === 'SUPPLIERS') return this.supplierValidator.validate(organizationId, records);
    return this.openingValidator.validate(organizationId, user, records);
  }

  private count(rows: ValidatedRow[]) {
    let valid = 0, invalid = 0, warning = 0;
    for (const r of rows) {
      const s = rowStatus(r);
      if (s === 'INVALID') invalid += 1;
      else if (s === 'WARNING') warning += 1;
      else valid += 1;
    }
    return { valid, invalid, warning };
  }

  private async loadJob(organizationId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  private assertTypePermission(user: RequestUser, type: ImportType) {
    if (!user.permissions.includes(PERMISSION_FOR[type])) {
      throw new ForbiddenException(`Missing permission ${PERMISSION_FOR[type]}`);
    }
  }

  private toJobResponse(j: {
    id: string; organizationId: string; type: ImportType; status: string; sourceFileName: string;
    totalRows: number; validRows: number; invalidRows: number; warningRows: number;
    createdById: string | null; createdAt: Date; committedAt: Date | null; error: string | null;
  }): ImportJobResponse {
    return {
      id: j.id, organizationId: j.organizationId, type: j.type, status: j.status as ImportJobResponse['status'],
      sourceFileName: j.sourceFileName, totalRows: j.totalRows, validRows: j.validRows,
      invalidRows: j.invalidRows, warningRows: j.warningRows, createdById: j.createdById,
      createdAt: j.createdAt.toISOString(), committedAt: j.committedAt ? j.committedAt.toISOString() : null,
      error: j.error,
    };
  }

  private toRowResponse(r: ValidatedRow): ImportRowResponse {
    return { rowNumber: r.rowNumber, status: rowStatus(r), rawData: r.raw, normalizedData: r.normalized, errors: r.errors, warnings: r.warnings };
  }
}
