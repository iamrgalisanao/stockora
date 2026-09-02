import { Injectable } from '@nestjs/common';
import { ENTITY_STATUSES } from '@iw/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { parseBool, parseDecimal } from '../csv.util';
import type { ValidatedRow } from '../import.types';

/**
 * Validates a product/variant/barcode import file against the database AND against itself (in-file
 * duplicates), producing normalized rows. Pure read — it writes nothing.
 *
 * Columns: sku, product_name, description, category, brand, unit_code, cost, selling_price,
 *          is_serialized, is_batch_tracked, status, barcode, parent_sku
 * A row with `parent_sku` is a variant of that base SKU; otherwise it defines a base product.
 * Categories/brands/units must ALREADY EXIST (no silent auto-create of typo'd master data).
 */
@Injectable()
export class ProductImportValidator {
  constructor(private readonly prisma: PrismaService) {}

  async validate(organizationId: string, records: Array<Record<string, string>>): Promise<ValidatedRow[]> {
    const [products, variants, barcodes, units, categories, brands] = await Promise.all([
      this.prisma.product.findMany({ where: { organizationId }, select: { sku: true } }),
      this.prisma.productVariant.findMany({ where: { organizationId }, select: { sku: true } }),
      this.prisma.productBarcode.findMany({ where: { organizationId }, select: { code: true } }),
      this.prisma.unitOfMeasure.findMany({ where: { organizationId }, select: { id: true, code: true } }),
      this.prisma.productCategory.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      this.prisma.brand.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);

    const dbSku = new Set(products.map((p) => p.sku).concat(variants.map((v) => v.sku)));
    const dbBarcode = new Set(barcodes.map((b) => b.code));
    const unitByCode = new Map(units.map((u) => [u.code.toLowerCase(), u.id]));
    const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

    // First pass: which SKUs are defined as BASE products in this very file (for parent resolution).
    const baseSkusInFile = new Set(
      records.filter((r) => (r.sku ?? '').trim() && !(r.parent_sku ?? '').trim()).map((r) => (r.sku ?? '').trim()),
    );

    const skuSeen = new Set<string>();
    const barcodeSeen = new Set<string>();
    const out: ValidatedRow[] = [];

    records.forEach((raw, i) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const sku = (raw.sku ?? '').trim();
      const parentSku = (raw.parent_sku ?? '').trim();
      const barcode = (raw.barcode ?? '').trim();
      const status = (raw.status ?? '').trim() || 'ACTIVE';

      if (!sku) errors.push('sku is required');
      else if (skuSeen.has(sku)) errors.push(`duplicate SKU "${sku}" in file`);
      else if (dbSku.has(sku)) errors.push(`SKU "${sku}" already exists`);
      if (sku) skuSeen.add(sku);

      if (!ENTITY_STATUSES.includes(status as never)) errors.push(`invalid status "${status}"`);

      if (barcode) {
        if (barcodeSeen.has(barcode)) errors.push(`duplicate barcode "${barcode}" in file`);
        else if (dbBarcode.has(barcode)) errors.push(`barcode "${barcode}" already exists`);
        barcodeSeen.add(barcode);
      }

      let normalized: Record<string, unknown> | null = null;

      if (parentSku) {
        // Variant row.
        if (!baseSkusInFile.has(parentSku) && !dbSku.has(parentSku)) {
          errors.push(`parent_sku "${parentSku}" not found in file or database`);
        }
        const cost = parseDecimal(raw.cost);
        const price = parseDecimal(raw.selling_price);
        if (cost !== null && Number.isNaN(cost)) errors.push('cost is not a number');
        if (price !== null && Number.isNaN(price)) errors.push('selling_price is not a number');
        normalized = { kind: 'variant', sku, parentSku, cost, sellingPrice: price, status, barcode: barcode || null };
      } else {
        // Base product row.
        const name = (raw.product_name ?? '').trim();
        if (!name) errors.push('product_name is required');
        const unitCode = (raw.unit_code ?? '').trim();
        if (!unitCode) errors.push('unit_code is required');
        else if (!unitByCode.has(unitCode.toLowerCase())) errors.push(`unknown unit "${unitCode}"`);

        const categoryName = (raw.category ?? '').trim();
        let categoryId: string | null = null;
        if (categoryName) {
          categoryId = categoryByName.get(categoryName.toLowerCase()) ?? null;
          if (!categoryId) errors.push(`unknown category "${categoryName}"`);
        }
        const brandName = (raw.brand ?? '').trim();
        let brandId: string | null = null;
        if (brandName) {
          brandId = brandByName.get(brandName.toLowerCase()) ?? null;
          if (!brandId) errors.push(`unknown brand "${brandName}"`);
        }

        const cost = parseDecimal(raw.cost);
        const price = parseDecimal(raw.selling_price);
        if (cost !== null && Number.isNaN(cost)) errors.push('cost is not a number');
        if (price !== null && Number.isNaN(price)) errors.push('selling_price is not a number');

        const isSerialized = parseBool(raw.is_serialized);
        const isBatch = parseBool(raw.is_batch_tracked);
        if ((raw.is_serialized ?? '').trim() && isSerialized === null) errors.push('is_serialized must be true/false');
        if ((raw.is_batch_tracked ?? '').trim() && isBatch === null) errors.push('is_batch_tracked must be true/false');

        normalized = {
          kind: 'product', sku, name, description: (raw.description ?? '').trim() || null,
          baseUomId: unitByCode.get(unitCode.toLowerCase()) ?? null, categoryId, brandId,
          cost, sellingPrice: price, isSerialized: isSerialized ?? false, isBatchTracked: isBatch ?? false,
          status, barcode: barcode || null,
        };
      }

      out.push({ rowNumber: i + 2, raw, normalized: errors.length ? null : normalized, errors, warnings });
    });

    return out;
  }
}
