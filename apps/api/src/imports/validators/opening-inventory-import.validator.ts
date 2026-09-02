import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestUser } from '../../common/request-user';
import { parseDecimal } from '../csv.util';
import type { ValidatedRow } from '../import.types';

/**
 * Validates an opening-inventory import — the strictest domain. Warehouse must exist, be ACTIVE and in
 * the user's scope; the location (if given) must belong to it and be ACTIVE; the SKU (product or
 * variant) must be ACTIVE; quantity must be positive (no negative opening balance); batch/serial items
 * are not yet supported via import. Pure read — commit posts through the ledger, not here.
 *
 * Columns: warehouse_code, location_code, sku, quantity, unit_cost
 */
@Injectable()
export class OpeningInventoryImportValidator {
  constructor(private readonly prisma: PrismaService) {}

  async validate(
    organizationId: string,
    user: RequestUser,
    records: Array<Record<string, string>>,
  ): Promise<ValidatedRow[]> {
    const [warehouses, locations, products, variants] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { organizationId }, select: { id: true, code: true, status: true } }),
      this.prisma.warehouseLocation.findMany({ where: { organizationId }, select: { id: true, code: true, warehouseId: true, status: true } }),
      this.prisma.product.findMany({ where: { organizationId }, select: { id: true, sku: true, status: true, isSerialized: true, isBatchTracked: true } }),
      this.prisma.productVariant.findMany({
        where: { organizationId },
        select: { id: true, sku: true, productId: true, status: true, product: { select: { isSerialized: true, isBatchTracked: true, status: true } } },
      }),
    ]);
    const whByCode = new Map(warehouses.map((w) => [w.code.toLowerCase(), w]));
    const productBySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
    const variantBySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v]));
    const scope = user.warehouseScope;

    const out: ValidatedRow[] = [];
    records.forEach((raw, i) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const whCode = (raw.warehouse_code ?? '').trim();
      const locCode = (raw.location_code ?? '').trim();
      const sku = (raw.sku ?? '').trim();

      const wh = whCode ? whByCode.get(whCode.toLowerCase()) : undefined;
      if (!whCode) errors.push('warehouse_code is required');
      else if (!wh) errors.push(`unknown warehouse "${whCode}"`);
      else if (wh.status !== 'ACTIVE') errors.push(`warehouse "${whCode}" is not ACTIVE`);
      else if (scope !== null && !scope.includes(wh.id)) errors.push(`warehouse "${whCode}" is outside your scope`);

      let locationId: string | null = null;
      if (locCode) {
        const loc = locations.find((l) => l.code.toLowerCase() === locCode.toLowerCase() && (!wh || l.warehouseId === wh.id));
        if (!loc) errors.push(`location "${locCode}" not found in warehouse "${whCode}"`);
        else if (loc.status !== 'ACTIVE') errors.push(`location "${locCode}" is not ACTIVE`);
        else locationId = loc.id;
      }

      let productId: string | null = null;
      let variantId: string | null = null;
      if (!sku) errors.push('sku is required');
      else {
        const p = productBySku.get(sku.toLowerCase());
        const v = variantBySku.get(sku.toLowerCase());
        if (p) {
          if (p.status !== 'ACTIVE') errors.push(`product "${sku}" is not ACTIVE`);
          if (p.isSerialized || p.isBatchTracked) errors.push(`product "${sku}" is serial/batch-tracked — opening import not supported yet`);
          productId = p.id;
        } else if (v) {
          if (v.status !== 'ACTIVE' || v.product.status !== 'ACTIVE') errors.push(`variant "${sku}" is not ACTIVE`);
          if (v.product.isSerialized || v.product.isBatchTracked) errors.push(`"${sku}" is serial/batch-tracked — opening import not supported yet`);
          productId = v.productId; variantId = v.id;
        } else {
          errors.push(`unknown SKU "${sku}"`);
        }
      }

      const qty = parseDecimal(raw.quantity);
      if (qty === null) errors.push('quantity is required');
      else if (Number.isNaN(qty)) errors.push('quantity is not a number');
      else if (qty <= 0) errors.push('quantity must be greater than 0 (no negative/zero opening balance)');

      const cost = parseDecimal(raw.unit_cost);
      if (cost === null) errors.push('unit_cost is required');
      else if (Number.isNaN(cost) || cost < 0) errors.push('unit_cost must be a non-negative number');

      const normalized = errors.length
        ? null
        : { warehouseId: wh!.id, locationId, productId, variantId, quantity: qty, unitCost: cost };
      out.push({ rowNumber: i + 2, raw, normalized, errors, warnings });
    });

    return out;
  }
}
