import { Injectable } from '@nestjs/common';
import { Prisma, ReceiptStatus } from '@prisma/client';
import {
  DEFAULT_SUPPLIER_SCORE_WEIGHTS,
  type SupplierPerformanceResponse,
  type SupplierPerformanceRow,
  type SupplierScoreComponent,
  type SupplierScoreWeightKey,
  type SupplierScoreWeights,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);
const MS_PER_DAY = 86_400_000;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface SupplierPerformanceFilter {
  from?: string;
  to?: string;
  productId?: string;
  warehouseId?: string;
  supplierId?: string;
}

// A supplier's running accumulators as receipts are folded in.
interface Acc {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  isPreferred: boolean;
  quotedLeadTimeDays: number | null;
  receiptsCount: number;
  ordered: Prisma.Decimal; // Σ expectedQty
  received: Prisma.Decimal; // Σ receivedQty
  rejected: Prisma.Decimal; // Σ rejectedQty
  // fill rate (lines with a known expected qty)
  fillExpected: Prisma.Decimal;
  fillReceived: Prisma.Decimal;
  linesTotal: number;
  linesWithExpected: number;
  // on-time (receipts with an expected delivery date)
  receiptsWithExpectedDate: number;
  onTimeCount: number;
  // lead time (receipts with an order date)
  receiptsWithOrderDate: number;
  leadTimeDaysSum: number;
  // price (lines with a supplier reference cost)
  priceActualValue: Prisma.Decimal; // Σ receivedQty × unitCost   (covered lines)
  priceReferenceValue: Prisma.Decimal; // Σ receivedQty × refCost (covered lines)
  priceCoveredQty: Prisma.Decimal; // Σ receivedQty               (covered lines)
}

@Injectable()
export class SupplierPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async compare(
    organizationId: string,
    user: RequestUser,
    filter: SupplierPerformanceFilter,
    weights: SupplierScoreWeights = DEFAULT_SUPPLIER_SCORE_WEIGHTS,
  ): Promise<SupplierPerformanceResponse> {
    const to = filter.to ? new Date(filter.to) : new Date();
    const from = filter.from ? new Date(filter.from) : new Date(to.getTime() - 90 * MS_PER_DAY);

    // Posted receipts only (never draft/cancelled), attributed to a supplier, in-period, in scope.
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
        items: { where: filter.productId ? { productId: filter.productId } : undefined },
      },
    });

    // Reference costs for the (supplier, product) pairs present.
    const supplierIds = [...new Set(receipts.map((r) => r.supplierId).filter((x): x is string => !!x))];
    const productIds = [...new Set(receipts.flatMap((r) => r.items.map((i) => i.productId)))];
    const refRows = supplierIds.length && productIds.length
      ? await this.prisma.supplierProduct.findMany({
          where: { organizationId, supplierId: { in: supplierIds }, productId: { in: productIds } },
          select: { supplierId: true, productId: true, cost: true },
        })
      : [];
    const refCost = new Map(refRows.map((r) => [`${r.supplierId}|${r.productId}`, D(r.cost)]));

    const accs = new Map<string, Acc>();
    for (const r of receipts) {
      const sup = r.supplier;
      if (!sup) continue;
      let a = accs.get(sup.id);
      if (!a) {
        a = {
          supplierId: sup.id, supplierCode: sup.code, supplierName: sup.companyName, isPreferred: sup.isPreferred,
          quotedLeadTimeDays: sup.leadTimeDays > 0 ? sup.leadTimeDays : null,
          receiptsCount: 0, ordered: ZERO, received: ZERO, rejected: ZERO,
          fillExpected: ZERO, fillReceived: ZERO, linesTotal: 0, linesWithExpected: 0,
          receiptsWithExpectedDate: 0, onTimeCount: 0, receiptsWithOrderDate: 0, leadTimeDaysSum: 0,
          priceActualValue: ZERO, priceReferenceValue: ZERO, priceCoveredQty: ZERO,
        };
        accs.set(sup.id, a);
      }
      a.receiptsCount += 1;
      if (r.expectedDeliveryDate) {
        a.receiptsWithExpectedDate += 1;
        if (r.receivingDate.getTime() <= r.expectedDeliveryDate.getTime()) a.onTimeCount += 1;
      }
      if (r.orderDate) {
        a.receiptsWithOrderDate += 1;
        a.leadTimeDaysSum += (r.receivingDate.getTime() - r.orderDate.getTime()) / MS_PER_DAY;
      }
      for (const it of r.items) {
        const expected = D(it.expectedQty);
        const received = D(it.receivedQty);
        const rejected = D(it.rejectedQty);
        a.linesTotal += 1;
        a.ordered = a.ordered.add(expected);
        a.received = a.received.add(received);
        a.rejected = a.rejected.add(rejected);
        if (expected.gt(0)) {
          a.linesWithExpected += 1;
          a.fillExpected = a.fillExpected.add(expected);
          a.fillReceived = a.fillReceived.add(received);
        }
        const ref = refCost.get(`${sup.id}|${it.productId}`);
        if (ref && ref.gt(0) && received.gt(0)) {
          a.priceActualValue = a.priceActualValue.add(received.mul(it.unitCost));
          a.priceReferenceValue = a.priceReferenceValue.add(received.mul(ref));
          a.priceCoveredQty = a.priceCoveredQty.add(received);
        }
      }
    }

    const suppliers = [...accs.values()]
      .map((a) => this.finalize(a, weights))
      .sort((x, y) => (y.performanceScore ?? -1) - (x.performanceScore ?? -1));

    // Org-level coverage (adoption of the optional inputs across the compared set).
    const totalReceipts = suppliers.reduce((s, r) => s + r.receiptsCount, 0);
    const sum = (f: (a: Acc) => number) => [...accs.values()].reduce((s, a) => s + f(a), 0);
    const covOnTime = totalReceipts ? (sum((a) => a.receiptsWithExpectedDate) / totalReceipts) * 100 : 0;
    const covLead = totalReceipts ? (sum((a) => a.receiptsWithOrderDate) / totalReceipts) * 100 : 0;
    const totalRcv = [...accs.values()].reduce((s, a) => s.add(a.received), ZERO);
    const covPrice = totalRcv.gt(0) ? [...accs.values()].reduce((s, a) => s.add(a.priceCoveredQty), ZERO).div(totalRcv).mul(100).toNumber() : 0;

    return {
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      weights,
      coverage: { onTimePct: round(covOnTime), leadTimePct: round(covLead), pricePct: round(covPrice) },
      suppliers,
    };
  }

  private finalize(a: Acc, weights: SupplierScoreWeights): SupplierPerformanceRow {
    // Fill rate.
    const fillRatePct = a.fillExpected.gt(0) ? round(a.fillReceived.div(a.fillExpected).mul(100).toNumber()) : null;
    // On-time.
    const onTimeDeliveryPct = a.receiptsWithExpectedDate > 0 ? round((a.onTimeCount / a.receiptsWithExpectedDate) * 100) : null;
    // Lead time.
    const averageLeadTimeDays = a.receiptsWithOrderDate > 0 ? round(a.leadTimeDaysSum / a.receiptsWithOrderDate, 1) : null;
    // Price.
    const averageUnitCost = a.priceCoveredQty.gt(0) ? a.priceActualValue.div(a.priceCoveredQty).toDecimalPlaces(4).toString() : null;
    const priceVariancePct = a.priceReferenceValue.gt(0)
      ? round(a.priceActualValue.sub(a.priceReferenceValue).div(a.priceReferenceValue).mul(100).toNumber())
      : null;
    // Quality (reject/return rate) — always available from posted receipts.
    const receivedPlusRejected = a.received.add(a.rejected);
    const returnRatePct = receivedPlusRejected.gt(0) ? round(a.rejected.div(receivedPlusRejected).mul(100).toNumber()) : 0;

    // Sub-scores (0–100); null when the metric has no coverage / benchmark.
    const subScores: Record<SupplierScoreWeightKey, number | null> = {
      fillRate: fillRatePct === null ? null : clamp(fillRatePct, 0, 100),
      onTime: onTimeDeliveryPct,
      leadTime: averageLeadTimeDays !== null && a.quotedLeadTimeDays && averageLeadTimeDays > 0
        ? clamp((a.quotedLeadTimeDays / averageLeadTimeDays) * 100, 0, 100)
        : null,
      price: priceVariancePct === null ? null : clamp(100 - priceVariancePct, 0, 100),
      quality: clamp(100 - returnRatePct, 0, 100),
    };
    const labels: Record<SupplierScoreWeightKey, string> = {
      fillRate: 'Fill rate', onTime: 'On-time delivery', leadTime: 'Lead time', price: 'Price', quality: 'Quality',
    };

    // Renormalize weights over the metrics that are actually available — a missing metric is dropped, never
    // silently scored zero.
    const availableWeight = SUPPLIER_SCORE_KEYS.reduce((s, k) => (subScores[k] === null ? s : s + weights[k]), 0);
    const components: SupplierScoreComponent[] = SUPPLIER_SCORE_KEYS.map((k) => ({
      key: k,
      label: labels[k],
      subScore: subScores[k] === null ? null : round(subScores[k]!),
      weight: subScores[k] === null || availableWeight === 0 ? 0 : round(weights[k] / availableWeight, 4),
    }));
    const performanceScore = availableWeight > 0
      ? round(SUPPLIER_SCORE_KEYS.reduce((s, k) => (subScores[k] === null ? s : s + subScores[k]! * (weights[k] / availableWeight)), 0))
      : null;

    return {
      supplierId: a.supplierId,
      supplierCode: a.supplierCode,
      supplierName: a.supplierName,
      isPreferred: a.isPreferred,
      receiptsCount: a.receiptsCount,
      orderedQuantity: a.ordered.toString(),
      receivedQuantity: a.received.toString(),
      rejectedQuantity: a.rejected.toString(),
      fillRatePct,
      averageLeadTimeDays,
      quotedLeadTimeDays: a.quotedLeadTimeDays,
      onTimeDeliveryPct,
      averageUnitCost,
      priceVariancePct,
      returnRatePct,
      performanceScore,
      components,
      coverage: {
        fillRatePct: a.linesTotal ? round((a.linesWithExpected / a.linesTotal) * 100) : 0,
        onTimePct: a.receiptsCount ? round((a.receiptsWithExpectedDate / a.receiptsCount) * 100) : 0,
        leadTimePct: a.receiptsCount ? round((a.receiptsWithOrderDate / a.receiptsCount) * 100) : 0,
        pricePct: a.received.gt(0) ? round(a.priceCoveredQty.div(a.received).mul(100).toNumber()) : 0,
      },
    };
  }
}

const SUPPLIER_SCORE_KEYS: SupplierScoreWeightKey[] = ['fillRate', 'onTime', 'leadTime', 'price', 'quality'];
