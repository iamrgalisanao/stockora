import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@iw/contracts';
import type {
  DeadStockRow,
  ReorderAssessment,
  ReorderState,
  ValuationGrouping,
  ValuationReport,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { ReorderAssessmentService } from '../inventory-policy/reorder-assessment.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reorder: ReorderAssessmentService,
  ) {}

  private whIn(user: RequestUser) {
    return user.warehouseScope !== null ? { in: user.warehouseScope } : undefined;
  }

  async valuation(
    organizationId: string,
    user: RequestUser,
    groupBy: ValuationGrouping,
  ): Promise<ValuationReport> {
    const whIn = this.whIn(user);
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, ...(whIn ? { warehouseId: whIn } : {}) },
      select: {
        onHand: true,
        avgCost: true,
        warehouse: { select: { id: true, code: true, name: true } },
        product: {
          select: {
            categoryId: true,
            brandId: true,
            category: { select: { name: true } },
            brand: { select: { name: true } },
          },
        },
      },
    });

    const groups = new Map<string, { label: string; onHand: Prisma.Decimal; value: Prisma.Decimal }>();
    let total = D(0);
    for (const b of balances) {
      let key: string;
      let label: string;
      if (groupBy === 'warehouse') {
        key = b.warehouse.id;
        label = `${b.warehouse.code} — ${b.warehouse.name}`;
      } else if (groupBy === 'category') {
        key = b.product.categoryId ?? 'uncategorized';
        label = b.product.category?.name ?? 'Uncategorized';
      } else {
        key = b.product.brandId ?? 'unbranded';
        label = b.product.brand?.name ?? 'Unbranded';
      }
      const value = D(b.onHand).mul(b.avgCost);
      total = total.add(value);
      const g = groups.get(key) ?? { label, onHand: D(0), value: D(0) };
      g.onHand = g.onHand.add(b.onHand);
      g.value = g.value.add(value);
      groups.set(key, g);
    }

    const rows = [...groups.entries()]
      .map(([key, g]) => ({ key, label: g.label, onHand: g.onHand.toString(), value: g.value.toDecimalPlaces(4).toString() }))
      .sort((a, b) => Number(b.value) - Number(a.value));

    return { groupBy, rows, totalValue: total.toDecimalPlaces(4).toString() };
  }

  /**
   * Policy-driven stock status: the authoritative reorder assessment, optionally
   * filtered to a single derived state. Sorted worst-first for operational triage.
   */
  async stockStatus(
    organizationId: string,
    user: RequestUser,
    filter?: ReorderState,
  ): Promise<ReorderAssessment[]> {
    const rows = await this.reorder.assess(organizationId, user);
    const filtered = filter ? rows.filter((r) => r.state === filter) : rows;
    const rank: Record<ReorderState, number> = {
      OUT_OF_STOCK: 0,
      REORDER_REQUIRED: 1,
      LOW_STOCK: 2,
      INBOUND_COVERED: 3,
      OVERSTOCK: 4,
      OK: 5,
    };
    return filtered.sort(
      (a, b) => rank[a.state] - rank[b.state] || a.productSku.localeCompare(b.productSku),
    );
  }

  async deadStock(organizationId: string, user: RequestUser, days: number): Promise<DeadStockRow[]> {
    const whIn = this.whIn(user);
    const canVal = user.permissions.includes(PERMISSIONS.VALUATION_VIEW);

    // Products currently holding stock (scoped).
    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId'],
      where: { organizationId, ...(whIn ? { warehouseId: whIn } : {}), onHand: { gt: 0 } },
      _sum: { onHand: true },
    });
    if (balances.length === 0) return [];
    const productIds = balances.map((b) => b.productId);

    // Last outbound (on_hand-reducing) movement per product.
    const lastOut = await this.prisma.inventoryMovement.groupBy({
      by: ['productId'],
      where: { organizationId, productId: { in: productIds }, onHandDelta: { lt: 0 }, ...(whIn ? { warehouseId: whIn } : {}) },
      _max: { postedAt: true },
    });
    const lastOutByProduct = new Map(lastOut.map((l) => [l.productId, l._max.postedAt]));

    // Value (weighted) per product.
    const valueRows = canVal
      ? await this.prisma.inventoryBalance.findMany({
          where: { organizationId, productId: { in: productIds }, ...(whIn ? { warehouseId: whIn } : {}) },
          select: { productId: true, onHand: true, avgCost: true },
        })
      : [];
    const valueByProduct = new Map<string, Prisma.Decimal>();
    for (const v of valueRows) {
      valueByProduct.set(v.productId, (valueByProduct.get(v.productId) ?? D(0)).add(D(v.onHand).mul(v.avgCost)));
    }

    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: productIds } },
      select: { id: true, sku: true, name: true },
    });
    const now = Date.now();
    const out: DeadStockRow[] = [];
    for (const p of products) {
      const last = lastOutByProduct.get(p.id) ?? null;
      const daysSince = last ? Math.floor((now - last.getTime()) / DAY_MS) : null;
      if (last !== null && daysSince !== null && daysSince < days) continue; // moved recently
      const onHand = balances.find((b) => b.productId === p.id)?._sum.onHand ?? D(0);
      const row: DeadStockRow = {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        onHand: D(onHand).toString(),
        lastOutboundAt: last ? last.toISOString() : null,
        daysSinceOutbound: daysSince,
      };
      if (canVal) row.value = D(valueByProduct.get(p.id) ?? 0).toDecimalPlaces(4).toString();
      out.push(row);
    }
    out.sort((a, b) => (b.daysSinceOutbound ?? Infinity) - (a.daysSinceOutbound ?? Infinity));
    return out;
  }
}
