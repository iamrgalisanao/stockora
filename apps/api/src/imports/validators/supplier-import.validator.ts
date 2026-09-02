import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDecimal } from '../csv.util';
import type { ValidatedRow } from '../import.types';

/**
 * Validates a supplier / supplier-product-link import. A row WITHOUT `product_sku` defines a supplier;
 * a row WITH `product_sku` links an (existing) product to a supplier (defined in-file or already in
 * the database). Pure read.
 *
 * Columns: code, company_name, contact_person, email, phone, lead_time_days,
 *          product_sku, supplier_sku, cost, min_order_qty
 */
@Injectable()
export class SupplierImportValidator {
  constructor(private readonly prisma: PrismaService) {}

  async validate(organizationId: string, records: Array<Record<string, string>>): Promise<ValidatedRow[]> {
    const [suppliers, products, links] = await Promise.all([
      this.prisma.supplier.findMany({ where: { organizationId }, select: { code: true } }),
      this.prisma.product.findMany({ where: { organizationId }, select: { sku: true } }),
      this.prisma.supplierProduct.findMany({
        where: { organizationId },
        select: { supplier: { select: { code: true } }, product: { select: { sku: true } } },
      }),
    ]);
    const dbSupplierCode = new Set(suppliers.map((s) => s.code));
    const dbProductSku = new Set(products.map((p) => p.sku));
    const dbLink = new Set(links.map((l) => `${l.supplier.code}|${l.product.sku}`));

    const defsInFile = new Set(
      records.filter((r) => (r.code ?? '').trim() && !(r.product_sku ?? '').trim()).map((r) => (r.code ?? '').trim()),
    );

    const codeSeen = new Set<string>();
    const linkSeen = new Set<string>();
    const out: ValidatedRow[] = [];

    records.forEach((raw, i) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const code = (raw.code ?? '').trim();
      const productSku = (raw.product_sku ?? '').trim();
      if (!code) errors.push('code is required');

      let normalized: Record<string, unknown> | null = null;

      if (!productSku) {
        // Supplier definition.
        const companyName = (raw.company_name ?? '').trim();
        if (!companyName) errors.push('company_name is required');
        if (code) {
          if (codeSeen.has(code)) errors.push(`duplicate supplier code "${code}" in file`);
          else if (dbSupplierCode.has(code)) errors.push(`supplier code "${code}" already exists`);
          codeSeen.add(code);
        }
        const lead = raw.lead_time_days?.trim() ? parseDecimal(raw.lead_time_days) : 0;
        if (lead !== null && (Number.isNaN(lead) || lead < 0)) errors.push('lead_time_days must be a non-negative number');
        normalized = {
          kind: 'supplier', code, companyName,
          contactPerson: (raw.contact_person ?? '').trim() || null,
          email: (raw.email ?? '').trim() || null,
          phone: (raw.phone ?? '').trim() || null,
          leadTimeDays: lead ?? 0,
        };
      } else {
        // Supplier-product link.
        if (code && !defsInFile.has(code) && !dbSupplierCode.has(code)) {
          errors.push(`unknown supplier code "${code}"`);
        }
        if (!dbProductSku.has(productSku)) errors.push(`unknown product "${productSku}"`);
        const linkKey = `${code}|${productSku}`;
        if (linkSeen.has(linkKey)) errors.push('duplicate supplier-product link in file');
        else if (dbLink.has(linkKey)) errors.push('supplier-product link already exists');
        linkSeen.add(linkKey);

        const cost = parseDecimal(raw.cost);
        const moq = parseDecimal(raw.min_order_qty);
        if (cost !== null && (Number.isNaN(cost) || cost < 0)) errors.push('cost must be a non-negative number');
        if (moq !== null && (Number.isNaN(moq) || moq < 0)) errors.push('min_order_qty must be a non-negative number');
        normalized = {
          kind: 'link', supplierCode: code, productSku,
          supplierSku: (raw.supplier_sku ?? '').trim() || null,
          cost: cost ?? 0, minOrderQty: moq,
        };
      }

      out.push({ rowNumber: i + 2, raw, normalized: errors.length ? null : normalized, errors, warnings });
    });

    return out;
  }
}
