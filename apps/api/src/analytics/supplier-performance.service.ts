import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, ReceiptStatus } from '@prisma/client';
import {
  DEFAULT_SUPPLIER_SCORE_WEIGHTS,
  type EvidenceMetric,
  type MetricTrend,
  type SupplierEvidenceRecord,
  type SupplierEvidenceResponse,
  type SupplierTrendBucket,
  type SupplierTrendSeriesResponse,
  type TrendGranularity,
  type PreferredSupplierComparisonResponse,
  type PreferredSupplierComparisonRow,
  type SampleLabel,
  type SupplierAnalyticsPolicyResponse,
  type SupplierPerformanceResponse,
  type SupplierPerformanceRow,
  type SupplierScoreComponent,
  type SupplierScoreWeightKey,
  type SupplierScoreWeights,
  type SupplierScorecardResponse,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from '../inventory/inventory.constants';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);
const MS_PER_DAY = 86_400_000;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const SCORE_KEYS: SupplierScoreWeightKey[] = ['fillRate', 'onTime', 'leadTime', 'price', 'quality'];
const LABELS: Record<SupplierScoreWeightKey, string> = {
  fillRate: 'Fill rate', onTime: 'On-time delivery', leadTime: 'Lead time', price: 'Price', quality: 'Quality',
};

export interface SupplierPerformanceFilter {
  from?: string;
  to?: string;
  productId?: string;
  warehouseId?: string;
  supplierId?: string;
}

type ReceiptPayload = Prisma.GoodsReceiptGetPayload<{
  include: {
    supplier: { select: { id: true; code: true; companyName: true; isPreferred: true; leadTimeDays: true } };
    items: { include: { product: { select: { sku: true; name: true } } } };
  };
}>;

interface Acc {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  isPreferred: boolean;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  quotedLeadTimeDays: number | null;
  receiptIds: Set<string>;
  ordered: Prisma.Decimal;
  received: Prisma.Decimal;
  rejected: Prisma.Decimal;
  fillExpected: Prisma.Decimal;
  fillReceived: Prisma.Decimal;
  linesTotal: number;
  linesWithExpected: number;
  receiptsWithExpectedDate: Set<string>;
  onTimeReceipts: Set<string>;
  receiptsWithOrderDate: Set<string>;
  leadTimeDaysByReceipt: Map<string, number>;
  priceActualValue: Prisma.Decimal;
  priceReferenceValue: Prisma.Decimal;
  priceCoveredQty: Prisma.Decimal;
}

@Injectable()
export class SupplierPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- org weights policy (2D.4B) ----

  async getWeights(organizationId: string): Promise<SupplierAnalyticsPolicyResponse> {
    const row = await this.prisma.supplierAnalyticsPolicy.findUnique({ where: { organizationId } });
    if (!row) return { ...DEFAULT_SUPPLIER_SCORE_WEIGHTS, configured: false };
    return {
      fillRate: Number(row.fillRateWeight), onTime: Number(row.onTimeWeight), leadTime: Number(row.leadTimeWeight),
      price: Number(row.priceWeight), quality: Number(row.qualityWeight), configured: true,
    };
  }

  async upsertWeights(organizationId: string, w: SupplierScoreWeights): Promise<SupplierAnalyticsPolicyResponse> {
    for (const k of SCORE_KEYS) {
      if (!(w[k] >= 0)) throw new BadRequestException(`Weight ${k} must be zero or greater`);
    }
    if (SCORE_KEYS.reduce((s, k) => s + w[k], 0) <= 0) {
      throw new BadRequestException('At least one weight must be greater than zero');
    }
    await this.prisma.supplierAnalyticsPolicy.upsert({
      where: { organizationId },
      create: { organizationId, fillRateWeight: w.fillRate, onTimeWeight: w.onTime, leadTimeWeight: w.leadTime, priceWeight: w.price, qualityWeight: w.quality },
      update: { fillRateWeight: w.fillRate, onTimeWeight: w.onTime, leadTimeWeight: w.leadTime, priceWeight: w.price, qualityWeight: w.quality },
    });
    return this.getWeights(organizationId);
  }

  private async weightsFor(organizationId: string): Promise<SupplierScoreWeights> {
    const w = await this.getWeights(organizationId);
    return { fillRate: w.fillRate, onTime: w.onTime, leadTime: w.leadTime, price: w.price, quality: w.quality };
  }

  // ---- comparison (2D.4A, now org-weighted) ----

  async compare(organizationId: string, user: RequestUser, filter: SupplierPerformanceFilter): Promise<SupplierPerformanceResponse> {
    const { from, to } = this.window(filter);
    const weights = await this.weightsFor(organizationId);
    const rows = await this.computeRows(organizationId, user, { ...filter, from: from.toISOString(), to: to.toISOString() }, weights, false);
    return {
      periodStart: from.toISOString(), periodEnd: to.toISOString(), weights,
      coverage: this.orgCoverage(rows),
      suppliers: rows.sort((a, b) => (b.performanceScore ?? -1) - (a.performanceScore ?? -1)),
    };
  }

  // ---- scorecard + trends + product breakdown (2D.4B) ----

  async scorecard(organizationId: string, user: RequestUser, supplierId: string, filter: SupplierPerformanceFilter): Promise<SupplierScorecardResponse> {
    const { from, to } = this.window(filter);
    const weights = await this.weightsFor(organizationId);
    const length = to.getTime() - from.getTime();
    const prevEnd = new Date(from.getTime() - 1);
    const prevStart = new Date(from.getTime() - length);

    const base = { productId: filter.productId, warehouseId: filter.warehouseId, supplierId };
    const [curr] = await this.computeRows(organizationId, user, { ...base, from: from.toISOString(), to: to.toISOString() }, weights, false);
    const [prev] = await this.computeRows(organizationId, user, { ...base, from: prevStart.toISOString(), to: prevEnd.toISOString() }, weights, false);
    const products = await this.computeRows(organizationId, user, { ...base, from: from.toISOString(), to: to.toISOString() }, weights, true);

    const supplier = curr ?? this.emptyRow(supplierId, prev);
    return {
      period: { start: from.toISOString(), end: to.toISOString() },
      previousPeriod: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
      weights,
      supplier,
      trends: this.buildTrends(curr ?? null, prev ?? null),
      products: products.sort((a, b) => (b.performanceScore ?? -1) - (a.performanceScore ?? -1)),
    };
  }

  private buildTrends(curr: SupplierPerformanceRow | null, prev: SupplierPerformanceRow | null): MetricTrend[] {
    const defs: Array<{ key: string; label: string; higherIsBetter: boolean; value: (r: SupplierPerformanceRow) => number | null; cov: (r: SupplierPerformanceRow) => number }> = [
      { key: 'score', label: 'Overall score', higherIsBetter: true, value: (r) => r.performanceScore, cov: () => 100 },
      { key: 'fillRate', label: 'Fill rate', higherIsBetter: true, value: (r) => r.fillRatePct, cov: (r) => r.coverage.fillRatePct },
      { key: 'onTime', label: 'On-time delivery', higherIsBetter: true, value: (r) => r.onTimeDeliveryPct, cov: (r) => r.coverage.onTimePct },
      { key: 'leadTime', label: 'Lead time', higherIsBetter: false, value: (r) => r.averageLeadTimeDays, cov: (r) => r.coverage.leadTimePct },
      { key: 'price', label: 'Price variance', higherIsBetter: false, value: (r) => r.priceVariancePct, cov: (r) => r.coverage.pricePct },
      { key: 'quality', label: 'Reject rate', higherIsBetter: false, value: (r) => r.returnRatePct, cov: () => 100 },
    ];
    return defs.map((d) => {
      const c = curr ? d.value(curr) : null;
      const p = prev ? d.value(prev) : null;
      const delta = c !== null && p !== null ? round(c - p) : null;
      const deltaPct = delta !== null && p !== null && p !== 0 ? round((delta / Math.abs(p)) * 100) : null;
      return {
        key: d.key, label: d.label, higherIsBetter: d.higherIsBetter,
        current: c, previous: p, delta, deltaPct,
        currentCoveragePct: curr ? d.cov(curr) : 0,
        previousCoveragePct: prev ? d.cov(prev) : 0,
      };
    });
  }

  // ---- time-series trends (2D.4C) ----

  async trends(organizationId: string, user: RequestUser, supplierId: string, filter: SupplierPerformanceFilter): Promise<SupplierTrendSeriesResponse> {
    const { from, to } = this.window(filter);
    const weights = await this.weightsFor(organizationId);
    const { receipts, refCost } = await this.fetchReceipts(organizationId, user, { ...filter, supplierId, from: from.toISOString(), to: to.toISOString() });
    const granularity = this.granularityFor(from, to);
    const buckets = this.bucketBoundaries(from, to, granularity).map((b): SupplierTrendBucket => {
      const inBucket = receipts.filter((r) => r.receivingDate.getTime() >= b.start.getTime() && r.receivingDate.getTime() <= b.end.getTime());
      const row = this.foldRows(inBucket, refCost, weights, false)[0];
      return {
        bucketStart: b.start.toISOString(), bucketEnd: b.end.toISOString(),
        receiptsCount: row?.receiptsCount ?? 0, linesCount: row?.linesCount ?? 0,
        performanceScore: row?.performanceScore ?? null,
        fillRatePct: row?.fillRatePct ?? null, onTimeDeliveryPct: row?.onTimeDeliveryPct ?? null,
        averageLeadTimeDays: row?.averageLeadTimeDays ?? null, priceVariancePct: row?.priceVariancePct ?? null,
        returnRatePct: row?.returnRatePct ?? 0,
        coverage: row?.coverage ?? { fillRatePct: 0, onTimePct: 0, leadTimePct: 0, pricePct: 0 },
      };
    });
    return {
      supplierId, from: from.toISOString(), to: to.toISOString(), granularity, weights,
      metrics: [
        { key: 'score', label: 'Overall score', higherIsBetter: true },
        { key: 'fillRate', label: 'Fill rate', higherIsBetter: true },
        { key: 'onTime', label: 'On-time delivery', higherIsBetter: true },
        { key: 'leadTime', label: 'Lead time', higherIsBetter: false },
        { key: 'price', label: 'Price variance', higherIsBetter: false },
        { key: 'quality', label: 'Reject rate', higherIsBetter: false },
      ],
      buckets,
    };
  }

  private granularityFor(from: Date, to: Date): TrendGranularity {
    const days = (to.getTime() - from.getTime()) / MS_PER_DAY;
    if (days <= 31) return 'DAILY';
    if (days <= 180) return 'WEEKLY';
    return 'MONTHLY';
  }

  private bucketBoundaries(from: Date, to: Date, g: TrendGranularity): Array<{ start: Date; end: Date }> {
    const out: Array<{ start: Date; end: Date }> = [];
    if (g === 'MONTHLY') {
      let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      while (cursor.getTime() <= to.getTime()) {
        const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
        const start = new Date(Math.max(cursor.getTime(), from.getTime()));
        const end = new Date(Math.min(next.getTime() - 1, to.getTime()));
        out.push({ start, end });
        cursor = next;
      }
      return out;
    }
    const step = (g === 'DAILY' ? 1 : 7) * MS_PER_DAY;
    for (let t = from.getTime(); t <= to.getTime(); t += step) {
      out.push({ start: new Date(t), end: new Date(Math.min(t + step - 1, to.getTime())) });
    }
    return out;
  }

  // ---- metric evidence / drill-down (2D.4C) ----

  async evidence(
    organizationId: string,
    user: RequestUser,
    supplierId: string,
    metric: EvidenceMetric,
    filter: SupplierPerformanceFilter,
    canViewCost: boolean,
  ): Promise<SupplierEvidenceResponse> {
    if (metric === 'PRICE' && !canViewCost) {
      throw new ForbiddenException('cost.view is required to drill into price performance');
    }
    const { from, to } = this.window(filter);
    const { receipts, refCost } = await this.fetchReceipts(organizationId, user, { ...filter, supplierId, from: from.toISOString(), to: to.toISOString() });
    const records: SupplierEvidenceRecord[] = [];
    let numerator = 0;
    let denominator = 0;

    const base = (r: ReceiptPayload) => ({ receiptId: r.id, receiptNumber: r.receiptNumber, receivingDate: r.receivingDate.toISOString(), warehouseId: r.warehouseId });

    if (metric === 'ON_TIME') {
      for (const r of receipts) {
        if (!r.expectedDeliveryDate) continue;
        const onTime = r.receivingDate.getTime() <= r.expectedDeliveryDate.getTime();
        denominator += 1; if (onTime) numerator += 1;
        records.push({ ...base(r), productId: null, productSku: null, includedInNumerator: onTime, expectedDeliveryDate: r.expectedDeliveryDate.toISOString(), onTime });
      }
    } else if (metric === 'LEAD_TIME') {
      for (const r of receipts) {
        if (!r.orderDate) continue;
        const leadTimeDays = round((r.receivingDate.getTime() - r.orderDate.getTime()) / MS_PER_DAY, 1);
        denominator += 1; numerator += leadTimeDays;
        records.push({ ...base(r), productId: null, productSku: null, includedInNumerator: true, orderDate: r.orderDate.toISOString(), leadTimeDays });
      }
    } else {
      for (const r of receipts) {
        for (const it of r.items) {
          const expected = D(it.expectedQty); const received = D(it.receivedQty); const rejected = D(it.rejectedQty);
          if (metric === 'FILL_RATE') {
            if (!expected.gt(0)) continue;
            numerator += received.toNumber(); denominator += expected.toNumber();
            records.push({ ...base(r), productId: it.productId, productSku: it.product.sku, includedInNumerator: received.gt(0), expectedQty: expected.toString(), receivedQty: received.toString() });
          } else if (metric === 'QUALITY') {
            denominator += received.add(rejected).toNumber(); numerator += rejected.toNumber();
            if (rejected.gt(0)) records.push({ ...base(r), productId: it.productId, productSku: it.product.sku, includedInNumerator: true, receivedQty: received.toString(), rejectedQty: rejected.toString() });
          } else { // PRICE
            const ref = refCost.get(`${supplierId}|${it.productId}`);
            if (!(ref && ref.gt(0) && received.gt(0))) continue;
            numerator += received.mul(it.unitCost).toNumber(); denominator += received.mul(ref).toNumber();
            records.push({ ...base(r), productId: it.productId, productSku: it.product.sku, includedInNumerator: true, receivedQty: received.toString(), unitCost: D(it.unitCost).toString(), referenceCost: ref.toString(), variancePct: round(D(it.unitCost).sub(ref).div(ref).mul(100).toNumber()) });
          }
        }
      }
    }

    const value = this.evidenceValue(metric, numerator, denominator);
    return {
      supplierId, metric, from: from.toISOString(), to: to.toISOString(),
      label: { FILL_RATE: 'Fill rate', ON_TIME: 'On-time delivery', LEAD_TIME: 'Lead time', PRICE: 'Price variance', QUALITY: 'Reject rate' }[metric],
      numerator: round(numerator), denominator: round(denominator), value,
      records: records.sort((a, b) => (a.receivingDate < b.receivingDate ? 1 : -1)),
    };
  }

  private evidenceValue(metric: EvidenceMetric, num: number, den: number): number | null {
    if (den === 0) return metric === 'QUALITY' ? 0 : null;
    if (metric === 'LEAD_TIME') return round(num / den, 1);
    if (metric === 'PRICE') return round(((num - den) / den) * 100);
    return round((num / den) * 100); // fill / on-time / quality
  }

  // ---- preferred-vs-observed comparison (2D.4B) ----

  async preferredComparison(organizationId: string, user: RequestUser, filter: SupplierPerformanceFilter): Promise<PreferredSupplierComparisonResponse> {
    const { from, to } = this.window(filter);
    const weights = await this.weightsFor(organizationId);
    const scope = user.warehouseScope;

    // Authoritative operational preference: InventoryPolicy.preferredSupplierId (NOT Supplier.isPreferred).
    const policies = await this.prisma.inventoryPolicy.findMany({
      where: {
        organizationId,
        preferredSupplierId: { not: null },
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
        ...(filter.productId ? { productId: filter.productId } : {}),
      },
      include: {
        preferredSupplier: { select: { id: true, companyName: true } },
        product: { select: { sku: true, name: true } },
        warehouse: { select: { code: true } },
      },
    });

    // Per-warehouse product/supplier scores over the period (comparable scoped data).
    const warehouses = [...new Set(policies.map((p) => p.warehouseId))];
    const scoreByWh = new Map<string, Map<string, SupplierPerformanceRow[]>>();
    for (const wh of warehouses) {
      const rows = await this.computeRows(organizationId, user, { warehouseId: wh, from: from.toISOString(), to: to.toISOString() }, weights, true);
      const byProduct = new Map<string, SupplierPerformanceRow[]>();
      for (const r of rows) {
        if (!r.productId) continue;
        (byProduct.get(r.productId) ?? byProduct.set(r.productId, []).get(r.productId)!).push(r);
      }
      scoreByWh.set(wh, byProduct);
    }

    const rows: PreferredSupplierComparisonRow[] = policies.map((pol) => {
      const candidates = scoreByWh.get(pol.warehouseId)?.get(pol.productId) ?? [];
      const preferred = candidates.find((c) => c.supplierId === pol.preferredSupplierId);
      const scored = candidates.filter((c) => c.performanceScore !== null);
      const best = scored.reduce<SupplierPerformanceRow | null>((b, c) => (b === null || (c.performanceScore ?? -1) > (b.performanceScore ?? -1) ? c : b), null);
      const preferredScore = preferred?.performanceScore ?? null;
      const bestScore = best?.performanceScore ?? null;
      return {
        productId: pol.productId,
        productSku: pol.product.sku,
        productName: pol.product.name,
        variantId: pol.variantId === NIL_UUID ? null : pol.variantId,
        warehouseId: pol.warehouseId,
        warehouseCode: pol.warehouse.code,
        preferredSupplierId: pol.preferredSupplierId!,
        preferredSupplierName: pol.preferredSupplier?.companyName ?? '—',
        preferredScore,
        bestSupplierId: best?.supplierId ?? null,
        bestSupplierName: best?.supplierName ?? null,
        bestScore,
        difference: preferredScore !== null && bestScore !== null ? round(bestScore - preferredScore) : null,
      };
    });

    return { period: { start: from.toISOString(), end: to.toISOString() }, rows };
  }

  // ---- core row computation (single engine, shared by every mode) ----

  private window(filter: SupplierPerformanceFilter): { from: Date; to: Date } {
    const to = filter.to ? new Date(filter.to) : new Date();
    const from = filter.from ? new Date(filter.from) : new Date(to.getTime() - 90 * MS_PER_DAY);
    return { from, to };
  }

  private async fetchReceipts(organizationId: string, user: RequestUser, filter: SupplierPerformanceFilter): Promise<{ receipts: ReceiptPayload[]; refCost: Map<string, Prisma.Decimal> }> {
    const to = new Date(filter.to!);
    const from = new Date(filter.from!);
    const scope = user.warehouseScope;
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: {
        organizationId,
        postedAt: { not: null },
        status: { in: [ReceiptStatus.COMPLETED, ReceiptStatus.PARTIALLY_RECEIVED] },
        supplierId: filter.supplierId ? filter.supplierId : { not: null },
        receivingDate: { gte: from, lte: to },
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
      },
      include: {
        supplier: { select: { id: true, code: true, companyName: true, isPreferred: true, leadTimeDays: true } },
        items: { where: filter.productId ? { productId: filter.productId } : undefined, include: { product: { select: { sku: true, name: true } } } },
      },
    });
    const supplierIds = [...new Set(receipts.map((r) => r.supplierId).filter((x): x is string => !!x))];
    const productIds = [...new Set(receipts.flatMap((r) => r.items.map((i) => i.productId)))];
    const refRows = supplierIds.length && productIds.length
      ? await this.prisma.supplierProduct.findMany({ where: { organizationId, supplierId: { in: supplierIds }, productId: { in: productIds } }, select: { supplierId: true, productId: true, cost: true } })
      : [];
    return { receipts, refCost: new Map(refRows.map((r) => [`${r.supplierId}|${r.productId}`, D(r.cost)])) };
  }

  private newAcc(sup: NonNullable<ReceiptPayload['supplier']>, it: ReceiptPayload['items'][number] | null, byProduct: boolean): Acc {
    return {
      supplierId: sup.id, supplierCode: sup.code, supplierName: sup.companyName, isPreferred: sup.isPreferred,
      productId: byProduct && it ? it.productId : null, productSku: byProduct && it ? it.product.sku : null, productName: byProduct && it ? it.product.name : null,
      quotedLeadTimeDays: sup.leadTimeDays > 0 ? sup.leadTimeDays : null,
      receiptIds: new Set(), ordered: ZERO, received: ZERO, rejected: ZERO,
      fillExpected: ZERO, fillReceived: ZERO, linesTotal: 0, linesWithExpected: 0,
      receiptsWithExpectedDate: new Set(), onTimeReceipts: new Set(), receiptsWithOrderDate: new Set(), leadTimeDaysByReceipt: new Map(),
      priceActualValue: ZERO, priceReferenceValue: ZERO, priceCoveredQty: ZERO,
    };
  }

  /** Fold one receipt line into an accumulator — the single source of truth for every metric definition. */
  private fold(a: Acc, r: ReceiptPayload, it: ReceiptPayload['items'][number], refCost: Map<string, Prisma.Decimal>): void {
    a.receiptIds.add(r.id);
    if (r.expectedDeliveryDate) {
      a.receiptsWithExpectedDate.add(r.id);
      if (r.receivingDate.getTime() <= r.expectedDeliveryDate.getTime()) a.onTimeReceipts.add(r.id);
    }
    if (r.orderDate) {
      a.receiptsWithOrderDate.add(r.id);
      a.leadTimeDaysByReceipt.set(r.id, (r.receivingDate.getTime() - r.orderDate.getTime()) / MS_PER_DAY);
    }
    const expected = D(it.expectedQty);
    const received = D(it.receivedQty);
    a.linesTotal += 1;
    a.ordered = a.ordered.add(expected);
    a.received = a.received.add(received);
    a.rejected = a.rejected.add(D(it.rejectedQty));
    if (expected.gt(0)) { a.linesWithExpected += 1; a.fillExpected = a.fillExpected.add(expected); a.fillReceived = a.fillReceived.add(received); }
    const ref = refCost.get(`${a.supplierId}|${it.productId}`);
    if (ref && ref.gt(0) && received.gt(0)) {
      a.priceActualValue = a.priceActualValue.add(received.mul(it.unitCost));
      a.priceReferenceValue = a.priceReferenceValue.add(received.mul(ref));
      a.priceCoveredQty = a.priceCoveredQty.add(received);
    }
  }

  private foldRows(receipts: ReceiptPayload[], refCost: Map<string, Prisma.Decimal>, weights: SupplierScoreWeights, byProduct: boolean): SupplierPerformanceRow[] {
    const accs = new Map<string, Acc>();
    for (const r of receipts) {
      const sup = r.supplier;
      if (!sup) continue;
      for (const it of r.items) {
        const key = byProduct ? `${sup.id}|${it.productId}` : sup.id;
        let a = accs.get(key);
        if (!a) { a = this.newAcc(sup, it, byProduct); accs.set(key, a); }
        this.fold(a, r, it, refCost);
      }
    }
    return [...accs.values()].map((a) => this.finalize(a, weights));
  }

  private async computeRows(organizationId: string, user: RequestUser, filter: SupplierPerformanceFilter, weights: SupplierScoreWeights, byProduct: boolean): Promise<SupplierPerformanceRow[]> {
    const { receipts, refCost } = await this.fetchReceipts(organizationId, user, filter);
    return this.foldRows(receipts, refCost, weights, byProduct);
  }

  private sampleLabel(receipts: number): SampleLabel {
    if (receipts >= 20) return 'HIGH_SAMPLE';
    if (receipts >= 5) return 'MODERATE_SAMPLE';
    return 'LOW_SAMPLE';
  }

  private finalize(a: Acc, weights: SupplierScoreWeights): SupplierPerformanceRow {
    const receiptsCount = a.receiptIds.size;
    const withExpectedDate = a.receiptsWithExpectedDate.size;
    const withOrderDate = a.receiptsWithOrderDate.size;

    const fillRatePct = a.fillExpected.gt(0) ? round(a.fillReceived.div(a.fillExpected).mul(100).toNumber()) : null;
    const onTimeDeliveryPct = withExpectedDate > 0 ? round((a.onTimeReceipts.size / withExpectedDate) * 100) : null;
    const leadSum = [...a.leadTimeDaysByReceipt.values()].reduce((s, v) => s + v, 0);
    const averageLeadTimeDays = withOrderDate > 0 ? round(leadSum / withOrderDate, 1) : null;
    const averageUnitCost = a.priceCoveredQty.gt(0) ? a.priceActualValue.div(a.priceCoveredQty).toDecimalPlaces(4).toString() : null;
    const priceVariancePct = a.priceReferenceValue.gt(0) ? round(a.priceActualValue.sub(a.priceReferenceValue).div(a.priceReferenceValue).mul(100).toNumber()) : null;
    const receivedPlusRejected = a.received.add(a.rejected);
    const returnRatePct = receivedPlusRejected.gt(0) ? round(a.rejected.div(receivedPlusRejected).mul(100).toNumber()) : 0;

    const raw: Record<SupplierScoreWeightKey, number | null> = {
      fillRate: fillRatePct, onTime: onTimeDeliveryPct, leadTime: averageLeadTimeDays, price: priceVariancePct, quality: returnRatePct,
    };
    const subScores: Record<SupplierScoreWeightKey, number | null> = {
      fillRate: fillRatePct === null ? null : clamp(fillRatePct, 0, 100),
      onTime: onTimeDeliveryPct,
      leadTime: averageLeadTimeDays !== null && a.quotedLeadTimeDays && averageLeadTimeDays > 0 ? clamp((a.quotedLeadTimeDays / averageLeadTimeDays) * 100, 0, 100) : null,
      price: priceVariancePct === null ? null : clamp(100 - priceVariancePct, 0, 100),
      quality: clamp(100 - returnRatePct, 0, 100),
    };

    const availableWeight = SCORE_KEYS.reduce((s, k) => (subScores[k] === null ? s : s + weights[k]), 0);
    const components: SupplierScoreComponent[] = SCORE_KEYS.map((k) => ({
      key: k, label: LABELS[k],
      rawMetric: raw[k] === null ? null : round(raw[k]!, k === 'leadTime' ? 1 : 2),
      subScore: subScores[k] === null ? null : round(subScores[k]!),
      configuredWeight: round(weights[k], 4),
      appliedWeight: subScores[k] === null || availableWeight === 0 ? 0 : round(weights[k] / availableWeight, 4),
    }));
    const performanceScore = availableWeight > 0
      ? round(SCORE_KEYS.reduce((s, k) => (subScores[k] === null ? s : s + subScores[k]! * (weights[k] / availableWeight)), 0))
      : null;

    return {
      supplierId: a.supplierId, supplierCode: a.supplierCode, supplierName: a.supplierName, isPreferred: a.isPreferred,
      productId: a.productId, productSku: a.productSku, productName: a.productName,
      receiptsCount, linesCount: a.linesTotal, sampleLabel: this.sampleLabel(receiptsCount),
      orderedQuantity: a.ordered.toString(), receivedQuantity: a.received.toString(), rejectedQuantity: a.rejected.toString(),
      fillRatePct, averageLeadTimeDays, quotedLeadTimeDays: a.quotedLeadTimeDays, onTimeDeliveryPct, averageUnitCost, priceVariancePct, returnRatePct,
      performanceScore, components,
      coverage: {
        fillRatePct: a.linesTotal ? round((a.linesWithExpected / a.linesTotal) * 100) : 0,
        onTimePct: receiptsCount ? round((withExpectedDate / receiptsCount) * 100) : 0,
        leadTimePct: receiptsCount ? round((withOrderDate / receiptsCount) * 100) : 0,
        pricePct: a.received.gt(0) ? round(a.priceCoveredQty.div(a.received).mul(100).toNumber()) : 0,
      },
    };
  }

  private orgCoverage(rows: SupplierPerformanceRow[]): { onTimePct: number; leadTimePct: number; pricePct: number } {
    const totalReceipts = rows.reduce((s, r) => s + r.receiptsCount, 0);
    const wOnTime = rows.reduce((s, r) => s + (r.coverage.onTimePct / 100) * r.receiptsCount, 0);
    const wLead = rows.reduce((s, r) => s + (r.coverage.leadTimePct / 100) * r.receiptsCount, 0);
    const totalRcv = rows.reduce((s, r) => s + Number(r.receivedQuantity), 0);
    const wPrice = rows.reduce((s, r) => s + (r.coverage.pricePct / 100) * Number(r.receivedQuantity), 0);
    return {
      onTimePct: totalReceipts ? round((wOnTime / totalReceipts) * 100) : 0,
      leadTimePct: totalReceipts ? round((wLead / totalReceipts) * 100) : 0,
      pricePct: totalRcv ? round((wPrice / totalRcv) * 100) : 0,
    };
  }

  private emptyRow(supplierId: string, prev?: SupplierPerformanceRow): SupplierPerformanceRow {
    return {
      supplierId, supplierCode: prev?.supplierCode ?? '—', supplierName: prev?.supplierName ?? '—', isPreferred: prev?.isPreferred ?? false,
      productId: null, productSku: null, productName: null,
      receiptsCount: 0, linesCount: 0, sampleLabel: 'LOW_SAMPLE',
      orderedQuantity: '0', receivedQuantity: '0', rejectedQuantity: '0',
      fillRatePct: null, averageLeadTimeDays: null, quotedLeadTimeDays: null, onTimeDeliveryPct: null, averageUnitCost: null, priceVariancePct: null, returnRatePct: 0,
      performanceScore: null,
      components: SCORE_KEYS.map((k) => ({ key: k, label: LABELS[k], rawMetric: null, subScore: null, configuredWeight: 0, appliedWeight: 0 })),
      coverage: { fillRatePct: 0, onTimePct: 0, leadTimePct: 0, pricePct: 0 },
    };
  }
}
