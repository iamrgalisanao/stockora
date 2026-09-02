import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from '../inventory/inventory.constants';
import { toCsv } from '../imports/csv.util';

const PRODUCT_HEADERS = [
  'sku', 'product_name', 'description', 'category', 'brand', 'unit_code',
  'cost', 'selling_price', 'is_serialized', 'is_batch_tracked', 'status', 'barcode', 'parent_sku',
];
const SUPPLIER_HEADERS = [
  'code', 'company_name', 'contact_person', 'email', 'phone', 'lead_time_days',
  'product_sku', 'supplier_sku', 'cost', 'min_order_qty',
];
const OPENING_HEADERS = ['warehouse_code', 'location_code', 'sku', 'quantity', 'unit_cost'];

const TEMPLATE_HEADERS: Record<string, string[]> = {
  products: PRODUCT_HEADERS,
  suppliers: SUPPLIER_HEADERS,
  'opening-inventory': OPENING_HEADERS,
};

/**
 * Read-only CSV export (2A.3B). Org-isolated and warehouse-scoped, cost gated by cost.view, and every
 * cell neutralized against CSV-injection (see {@link toCsv}). Export formats mirror the import
 * templates so a file can round-trip.
 */
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  template(type: string): string {
    return toCsv(TEMPLATE_HEADERS[type] ?? [], []);
  }

  async products(organizationId: string, user: RequestUser): Promise<string> {
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const products = await this.prisma.product.findMany({
      where: { organizationId },
      orderBy: { sku: 'asc' },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        baseUom: { select: { code: true } },
        variants: { orderBy: { sku: 'asc' }, select: { id: true, sku: true, cost: true, sellingPrice: true, status: true } },
        barcodes: { where: { status: 'ACTIVE' }, select: { code: true, variantId: true, isPrimary: true } },
      },
    });

    const rows: Array<Array<unknown>> = [];
    for (const p of products) {
      const baseBc = pickBarcode(p.barcodes.filter((b) => b.variantId === null));
      rows.push([
        p.sku, p.name, p.description ?? '', p.category?.name ?? '', p.brand?.name ?? '', p.baseUom.code,
        canCost ? p.cost.toString() : '', p.sellingPrice.toString(),
        p.isSerialized, p.isBatchTracked, p.status, baseBc ?? '', '',
      ]);
      for (const v of p.variants) {
        const vbc = pickBarcode(p.barcodes.filter((b) => b.variantId === v.id));
        rows.push([
          v.sku, p.name, '', '', '', '',
          canCost ? (v.cost?.toString() ?? '') : '', v.sellingPrice?.toString() ?? '',
          '', '', v.status, vbc ?? '', p.sku,
        ]);
      }
    }
    return toCsv(PRODUCT_HEADERS, rows);
  }

  async suppliers(organizationId: string, user: RequestUser): Promise<string> {
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const suppliers = await this.prisma.supplier.findMany({
      where: { organizationId },
      orderBy: { code: 'asc' },
      include: {
        supplierProducts: { include: { product: { select: { sku: true } } } },
      },
    });
    const rows: Array<Array<unknown>> = [];
    for (const s of suppliers) {
      rows.push([s.code, s.companyName, s.contactPerson ?? '', s.email ?? '', s.phone ?? '', s.leadTimeDays, '', '', '', '']);
      for (const sp of s.supplierProducts) {
        rows.push([
          s.code, '', '', '', '', '',
          sp.product.sku, sp.supplierSku ?? '', canCost ? sp.cost.toString() : '', sp.minOrderQty?.toString() ?? '',
        ]);
      }
    }
    return toCsv(SUPPLIER_HEADERS, rows);
  }

  /** Stock balances shaped as the opening-inventory template, so the export doubles as a re-import. */
  async stockBalances(organizationId: string, user: RequestUser): Promise<string> {
    const canCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    const scope = user.warehouseScope;
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, onHand: { gt: 0 }, ...(scope ? { warehouseId: { in: scope } } : {}) },
      include: { product: { select: { sku: true } }, warehouse: { select: { code: true } } },
      orderBy: [{ warehouse: { code: 'asc' } }, { productId: 'asc' }],
    });

    const variantIds = [...new Set(balances.map((b) => b.variantId).filter((v) => v !== NIL_UUID))];
    const variantSku = new Map(
      (variantIds.length
        ? await this.prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true } })
        : []
      ).map((v) => [v.id, v.sku]),
    );

    const rows: Array<Array<unknown>> = balances.map((b) => [
      b.warehouse.code, '',
      b.variantId === NIL_UUID ? b.product.sku : variantSku.get(b.variantId) ?? b.product.sku,
      b.onHand.toString(),
      canCost ? b.avgCost.toString() : '',
    ]);
    return toCsv(OPENING_HEADERS, rows);
  }
}

function pickBarcode(barcodes: Array<{ code: string; isPrimary: boolean }>): string | null {
  if (barcodes.length === 0) return null;
  return (barcodes.find((b) => b.isPrimary) ?? barcodes[0])!.code;
}
