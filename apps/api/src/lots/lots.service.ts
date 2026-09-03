import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LotMovementRow, LotOrigin, LotResponse, LotStockRow, PickableLot } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryPostingService, type StockLine } from '../inventory/inventory-posting.service';
import type { RequestUser } from '../common/request-user';
import { BucketDeltas, D, NIL_UUID, ZERO } from '../inventory/inventory.constants';
import { DEFAULT_BUSINESS_TZ, daysUntil, expiryStateOf, isExpired, toBusinessDate } from '../common/business-date';
import { DEFAULT_EXPIRING_SOON_DAYS, type AllocationPlan, type AllocationStrategy, type LotExpiryState } from '@iw/contracts';

/** A stock line carrying raw lot metadata, resolved to a lotId before posting. */
export interface LotLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCost?: number | null;
  locationId?: string | null;
  lotNumber?: string;
  manufacturedAt?: string;
  expiryDate?: string;
  supplierId?: string;
  allowShortShelfLife?: boolean;
}

export interface ResolveLotInput {
  lotNumber?: string;
  manufacturedAt?: string | null;
  expiryDate?: string | null;
  supplierId?: string | null;
  allowShortShelfLife?: boolean;
}

export interface LotListFilter {
  productId?: string;
  status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  q?: string;
  warehouseId?: string; // lots with a balance row in this warehouse
  supplierId?: string;
  hasStock?: boolean; // lots with non-zero on-hand somewhere in scope
  expiryState?: LotExpiryState; // derived filter (EXPIRED / EXPIRING_SOON / HEALTHY / NO_EXPIRY)
}

/** referenceType → the model + human-number column used to resolve a movement's source document. */
const DOC_SOURCES: Record<string, { model: string; field: string }> = {
  goods_receipt: { model: 'goodsReceipt', field: 'receiptNumber' },
  stock_release: { model: 'stockRelease', field: 'releaseNumber' },
  stock_transfer: { model: 'stockTransfer', field: 'transferNumber' },
  stock_adjustment: { model: 'stockAdjustment', field: 'adjustmentNumber' },
  stock_count: { model: 'stockCount', field: 'countNumber' },
  inventory_return: { model: 'inventoryReturn', field: 'returnNo' },
};
const DOC_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  lot_migration: 'Legacy lot migration',
  reversal: 'Reversal',
};

type LotRow = Prisma.InventoryLotGetPayload<{ include: { product: { select: { sku: true; name: true } } } }>;
const LOT_INCLUDE = { product: { select: { sku: true, name: true } } } as const;
const sameInstant = (a: Date | null, b: string) => a !== null && a.getTime() === new Date(b).getTime();

@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: InventoryPostingService,
  ) {}

  /**
   * Resolve the lot for a physical posting (ADR 0007) — find-or-create by (org, product, variant,
   * lotNumber). Returns null for a non-batch product (and rejects a lot on one). For a batch-tracked
   * product a lot number is required; a hit whose identity metadata conflicts is rejected for review.
   */
  async resolveLotId(
    organizationId: string,
    actorId: string | null,
    productId: string,
    variantId: string, // NIL_UUID for base product
    isBatchTracked: boolean,
    input: ResolveLotInput,
    origin: LotOrigin,
  ): Promise<string | null> {
    const lotNumber = input.lotNumber?.trim();
    if (!isBatchTracked) {
      if (lotNumber) throw new BadRequestException('This product is not batch-tracked and cannot take a lot number');
      return null;
    }
    if (!lotNumber) throw new BadRequestException('This product is batch-tracked; a lot number is required');

    // Metadata integrity (the only expiry rule in 2C.1 — no FEFO).
    if (input.manufacturedAt && input.expiryDate && new Date(input.expiryDate) <= new Date(input.manufacturedAt)) {
      throw new BadRequestException('expiryDate must be after manufacturedAt');
    }

    const existing = await this.prisma.inventoryLot.findFirst({
      where: { organizationId, productId, variantId, lotNumber },
    });
    if (existing) {
      // Lot identity is stable: a later entry may not silently change recorded metadata.
      if (input.manufacturedAt && !sameInstant(existing.manufacturedAt, input.manufacturedAt)) {
        throw new ConflictException(`Lot ${lotNumber} already exists with a different manufactured date`);
      }
      if (input.expiryDate && !sameInstant(existing.expiryDate, input.expiryDate)) {
        throw new ConflictException(`Lot ${lotNumber} already exists with a different expiry date`);
      }
    }

    // Shelf-life policy enforcement at stock entry (ADR 0008): expiry-required + minimum shelf life.
    const effectiveExpiry = existing ? existing.expiryDate : (input.expiryDate ? new Date(input.expiryDate) : null);
    await this.enforceShelfLifeAtEntry(organizationId, actorId, productId, variantId, lotNumber, effectiveExpiry, input.allowShortShelfLife ?? false);

    if (existing) return existing.id;

    const created = await this.prisma.inventoryLot.create({
      data: {
        organizationId, productId, variantId, lotNumber, origin,
        manufacturedAt: input.manufacturedAt ? new Date(input.manufacturedAt) : null,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        supplierId: input.supplierId ?? null,
        receivedAt: new Date(),
      },
    });
    await this.audit.record({
      organizationId, userId: actorId, action: 'lot.created', entityType: 'lot',
      entityId: created.id, entityDisplay: lotNumber, newValue: { productId, origin },
    });
    return created.id;
  }

  /** Fetch (org,product,variant) shelf-life policy fields, falling back to the product's expiry flag. */
  private async shelfLife(organizationId: string, productId: string, variantId: string) {
    const policy = await this.prisma.shelfLifePolicy.findUnique({
      where: { organizationId_productId_variantId: { organizationId, productId, variantId } },
    });
    if (policy) {
      return {
        expiryRequired: policy.expiryTrackingRequired,
        minDays: policy.minimumShelfLifeOnReceiptDays,
        expiringSoonDays: policy.expiringSoonDays ?? DEFAULT_EXPIRING_SOON_DAYS,
      };
    }
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { isExpiryTracked: true } });
    return { expiryRequired: product?.isExpiryTracked ?? false, minDays: null as number | null, expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS };
  }

  private async enforceShelfLifeAtEntry(
    organizationId: string, actorId: string | null, productId: string, variantId: string,
    lotNumber: string, effectiveExpiry: Date | null, allowShortShelfLife: boolean,
  ): Promise<void> {
    const { expiryRequired, minDays } = await this.shelfLife(organizationId, productId, variantId);
    if (expiryRequired && !effectiveExpiry) {
      throw new BadRequestException('This product requires an expiry date to receive stock');
    }
    if (minDays != null && effectiveExpiry) {
      const remaining = daysUntil(toBusinessDate(effectiveExpiry, DEFAULT_BUSINESS_TZ), DEFAULT_BUSINESS_TZ);
      if (remaining < minDays) {
        if (!allowShortShelfLife) {
          throw new BadRequestException(`Lot has ${remaining} day(s) of shelf life; minimum on receipt is ${minDays}`);
        }
        await this.audit.record({
          organizationId, userId: actorId, action: 'lot.short_shelf_life_override', entityType: 'lot',
          entityDisplay: lotNumber, newValue: { remainingDays: remaining, minimumDays: minDays },
        });
      }
    }
  }

  /** Resolve a batch of entry lines (opening inventory / any find-or-create entry) to posting StockLines. */
  async resolveEntryLines(organizationId: string, actorId: string | null, lines: LotLineInput[], origin: LotOrigin): Promise<StockLine[]> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, isBatchTracked: true },
    });
    const tracked = new Map(products.map((p) => [p.id, p.isBatchTracked]));
    const out: StockLine[] = [];
    for (const l of lines) {
      const isBatchTracked = tracked.get(l.productId);
      if (isBatchTracked === undefined) throw new BadRequestException(`Product ${l.productId} not found`);
      const variantId = l.variantId ?? NIL_UUID;
      const lotId = await this.resolveLotId(organizationId, actorId, l.productId, variantId, isBatchTracked, l, origin);
      out.push({ productId: l.productId, variantId: l.variantId ?? null, quantity: l.quantity, unitCost: l.unitCost ?? null, locationId: l.locationId ?? null, lotId });
    }
    return out;
  }

  // ---- reads ----

  async list(organizationId: string, user: RequestUser, filter: LotListFilter = {}): Promise<LotResponse[]> {
    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        organizationId,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
        ...(filter.q
          ? { OR: [{ lotNumber: { contains: filter.q, mode: 'insensitive' } }, { product: { sku: { contains: filter.q, mode: 'insensitive' } } }] }
          : {}),
      },
      include: LOT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (lots.length === 0) return [];

    const scope = user.warehouseScope;
    const grouped = await this.prisma.inventoryBalance.groupBy({
      by: ['lotId'],
      where: {
        organizationId,
        lotId: { in: lots.map((l) => l.id) },
        ...(scope !== null ? { warehouseId: { in: scope } } : {}),
      },
      _sum: { onHand: true, reserved: true, inTransit: true, quarantined: true, damaged: true },
    });
    const totals = new Map(grouped.map((g) => [g.lotId, g._sum]));

    // Optional stock-based filters (post-aggregation).
    let lotIdsInWarehouse: Set<string> | null = null;
    if (filter.warehouseId) {
      const rows = await this.prisma.inventoryBalance.findMany({
        where: { organizationId, warehouseId: filter.warehouseId, lotId: { in: lots.map((l) => l.id) }, onHand: { not: 0 } },
        select: { lotId: true },
      });
      lotIdsInWarehouse = new Set(rows.map((r) => r.lotId));
    }
    return lots
      .filter((l) => {
        if (lotIdsInWarehouse && !lotIdsInWarehouse.has(l.id)) return false;
        if (filter.hasStock && !(totals.get(l.id)?.onHand && !totals.get(l.id)!.onHand!.equals(0))) return false;
        return true;
      })
      .map((l) => this.toResponse(l, totals.get(l.id)))
      .filter((r) => !filter.expiryState || r.expiryState === filter.expiryState);
  }

  /** The chronological ledger timeline for a lot, with each movement's source document resolved. */
  async movements(organizationId: string, user: RequestUser, id: string): Promise<LotMovementRow[]> {
    const lot = await this.prisma.inventoryLot.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!lot) throw new NotFoundException('Lot not found');
    const scope = user.warehouseScope;
    const ms = await this.prisma.inventoryMovement.findMany({
      where: { organizationId, lotId: id, ...(scope !== null ? { warehouseId: { in: scope } } : {}) },
      include: { warehouse: { select: { code: true } } },
      orderBy: [{ postedAt: 'asc' }, { txnNumber: 'asc' }],
    });

    // Resolve human document numbers per referenceType in one query each (no N+1).
    const refs = new Map<string, string>(); // referenceId -> number
    const byType = new Map<string, Set<string>>();
    for (const m of ms) {
      if (m.referenceType && m.referenceId && DOC_SOURCES[m.referenceType]) {
        (byType.get(m.referenceType) ?? byType.set(m.referenceType, new Set()).get(m.referenceType)!).add(m.referenceId);
      }
    }
    const delegates = this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Array<Record<string, string>>> }>;
    for (const [type, ids] of byType) {
      const src = DOC_SOURCES[type];
      if (!src) continue;
      const rows = await delegates[src.model]!.findMany({ where: { organizationId, id: { in: [...ids] } }, select: { id: true, [src.field]: true } });
      for (const r of rows) {
        const num = r[src.field];
        if (r.id && num) refs.set(r.id, num);
      }
    }

    return ms.map((m) => ({
      id: m.id,
      occurredAt: m.postedAt.toISOString(),
      movementType: m.movementType,
      warehouseId: m.warehouseId,
      warehouseCode: m.warehouse.code,
      onHandDelta: m.onHandDelta.toString(),
      reservedDelta: m.reservedDelta.toString(),
      inTransitDelta: m.inTransitDelta.toString(),
      quarantinedDelta: m.quarantinedDelta.toString(),
      damagedDelta: m.damagedDelta.toString(),
      documentType: m.referenceType,
      documentId: m.referenceId,
      documentReference: (m.referenceId && refs.get(m.referenceId)) ?? (m.referenceType ? DOC_LABELS[m.referenceType] ?? null : null),
      actorId: m.performedById,
    }));
  }

  /** The configured allocation strategy for a product/variant (ADR 0008); MANUAL when no policy is set. */
  async allocationStrategyFor(organizationId: string, productId: string, variantId = NIL_UUID): Promise<AllocationStrategy> {
    const policy = await this.prisma.shelfLifePolicy.findUnique({
      where: { organizationId_productId_variantId: { organizationId, productId, variantId } },
      select: { allocationStrategy: true },
    });
    return policy?.allocationStrategy ?? 'MANUAL';
  }

  /**
   * Deterministic FEFO allocation plan (ADR 0008 §4) — pure/read-only. Candidates: ACTIVE, non-expired,
   * available > 0 at the warehouse; ordered expiryDate ASC (no-expiry last), receivedAt ASC, lotNumber ASC,
   * id ASC; greedily filled. `complete` is false when eligible stock cannot cover the request (strict mode
   * is enforced by the caller, not here).
   */
  async fefoPlan(
    organizationId: string, user: RequestUser, productId: string, variantId: string, warehouseId: string, quantity: Prisma.Decimal,
  ): Promise<AllocationPlan> {
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    const lots = await this.prisma.inventoryLot.findMany({
      where: { organizationId, productId, variantId, status: 'ACTIVE' },
    });
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, productId, variantId, warehouseId, lotId: { in: lots.map((l) => l.id) } },
    });
    const balByLot = new Map(balances.map((b) => [b.lotId, b]));
    const candidates = lots
      .map((l) => {
        const b = balByLot.get(l.id);
        const available = b ? b.onHand.sub(b.reserved).sub(b.quarantined) : new Prisma.Decimal(0);
        return { lot: l, available };
      })
      .filter((c) => c.available.gt(0) && !isExpired(c.lot.expiryDate, DEFAULT_BUSINESS_TZ))
      .sort((a, b) => this.fefoOrder(a.lot, b.lot));

    let remaining = quantity;
    const allocations: AllocationPlan['allocations'] = [];
    for (const c of candidates) {
      if (remaining.lte(0)) break;
      const take = Prisma.Decimal.min(c.available, remaining);
      if (take.gt(0)) {
        allocations.push({ lotId: c.lot.id, lotNumber: c.lot.lotNumber, expiryDate: c.lot.expiryDate ? c.lot.expiryDate.toISOString() : null, quantity: take.toString() });
        remaining = remaining.sub(take);
      }
    }
    const allocated = quantity.sub(remaining);
    return {
      requestedQuantity: quantity.toString(), allocatedQuantity: allocated.toString(),
      complete: remaining.lte(0), strategy: 'FEFO', generatedAt: new Date().toISOString(), allocations,
    };
  }

  /** FEFO ordering: expiry ASC (no-expiry last), then receivedAt ASC, lotNumber ASC, id ASC — deterministic. */
  private fefoOrder(a: { expiryDate: Date | null; receivedAt: Date | null; lotNumber: string; id: string }, b: { expiryDate: Date | null; receivedAt: Date | null; lotNumber: string; id: string }): number {
    if (a.expiryDate && b.expiryDate) { const d = a.expiryDate.getTime() - b.expiryDate.getTime(); if (d) return d; }
    else if (a.expiryDate && !b.expiryDate) return -1;
    else if (!a.expiryDate && b.expiryDate) return 1;
    const ra = a.receivedAt?.getTime() ?? 0, rb = b.receivedAt?.getTime() ?? 0;
    if (ra !== rb) return ra - rb;
    if (a.lotNumber !== b.lotNumber) return a.lotNumber < b.lotNumber ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  /** ACTIVE lots of a product selectable at a warehouse, with that warehouse's buckets (the picker feed). */
  async pickable(organizationId: string, user: RequestUser, productId: string, warehouseId: string, variantId?: string): Promise<PickableLot[]> {
    if (user.warehouseScope !== null && !user.warehouseScope.includes(warehouseId)) {
      throw new ForbiddenException('You do not have access to this warehouse');
    }
    const lots = await this.prisma.inventoryLot.findMany({
      where: { organizationId, productId, variantId: variantId ?? NIL_UUID, status: 'ACTIVE' },
      orderBy: [{ expiryDate: 'asc' }, { lotNumber: 'asc' }],
    });
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, productId, variantId: variantId ?? NIL_UUID, warehouseId, lotId: { in: lots.map((l) => l.id) } },
    });
    const balByLot = new Map(balances.map((b) => [b.lotId, b]));
    return lots
      .map((l) => {
        const b = balByLot.get(l.id);
        const onHand = b ? b.onHand : new Prisma.Decimal(0);
        const reserved = b ? b.reserved : new Prisma.Decimal(0);
        const quarantined = b ? b.quarantined : new Prisma.Decimal(0);
        return {
          lotId: l.id, lotNumber: l.lotNumber, status: l.status, origin: l.origin,
          expiryDate: l.expiryDate ? l.expiryDate.toISOString() : null,
          expiryState: expiryStateOf(l.expiryDate, DEFAULT_EXPIRING_SOON_DAYS, DEFAULT_BUSINESS_TZ),
          onHand: onHand.toString(), reserved: reserved.toString(), quarantined: quarantined.toString(),
          available: onHand.sub(reserved).sub(quarantined).toString(),
          _expiry: l.expiryDate,
        };
      })
      // Only lots with stock at this warehouse that are NOT expired are pickable (ADR 0008 §2).
      .filter((l) => Number(l.onHand) > 0 && !isExpired(l._expiry, DEFAULT_BUSINESS_TZ))
      .map(({ _expiry, ...l }) => l);
  }

  async get(organizationId: string, user: RequestUser, id: string): Promise<LotResponse> {
    const lot = await this.prisma.inventoryLot.findFirst({ where: { id, organizationId }, include: LOT_INCLUDE });
    if (!lot) throw new NotFoundException('Lot not found');
    const scope = user.warehouseScope;
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, lotId: id, ...(scope !== null ? { warehouseId: { in: scope } } : {}) },
      include: { warehouse: { select: { code: true } } },
    });
    const stock: LotStockRow[] = balances.map((b) => ({
      warehouseId: b.warehouseId,
      warehouseCode: b.warehouse.code,
      onHand: b.onHand.toString(),
      reserved: b.reserved.toString(),
      quarantined: b.quarantined.toString(),
      damaged: b.damaged.toString(),
      inTransit: b.inTransit.toString(),
      available: b.onHand.sub(b.reserved).sub(b.quarantined).toString(),
    }));
    const sum = (k: 'onHand' | 'reserved' | 'inTransit' | 'quarantined' | 'damaged') =>
      balances.reduce((a, b) => a.add(b[k]), new Prisma.Decimal(0));
    return {
      ...this.toResponse(lot, { onHand: sum('onHand'), reserved: sum('reserved'), inTransit: sum('inTransit'), quarantined: sum('quarantined'), damaged: sum('damaged') }),
      stock,
    };
  }

  // ---- close ----

  async close(organizationId: string, user: RequestUser, id: string): Promise<LotResponse> {
    const lot = await this.prisma.inventoryLot.findFirst({ where: { id, organizationId } });
    if (!lot) throw new NotFoundException('Lot not found');
    if (lot.status === 'CLOSED') return this.get(organizationId, user, id);
    if (lot.status !== 'ACTIVE') throw new ConflictException(`A ${lot.status} lot cannot be closed`);

    // A lot with any remaining physical exposure cannot be closed (ADR 0007).
    const agg = await this.prisma.inventoryBalance.aggregate({
      where: { organizationId, lotId: id },
      _sum: { onHand: true, reserved: true, inTransit: true, quarantined: true, damaged: true },
    });
    const s = agg._sum;
    const nonZero = [s.onHand, s.reserved, s.inTransit, s.quarantined, s.damaged].some((v) => v && !v.equals(0));
    if (nonZero) throw new BadRequestException('Cannot close a lot that still holds stock in any bucket');

    await this.prisma.inventoryLot.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'lot.closed', entityType: 'lot',
      entityId: id, entityDisplay: lot.lotNumber, oldValue: { status: lot.status }, newValue: { status: 'CLOSED' },
    });
    return this.get(organizationId, user, id);
  }

  // ---- legacy backfill (ADR 0007 migration safety) ----

  /**
   * Repoint legacy batch stock (batch-tracked product, NIL-lot balance, non-zero buckets) onto an
   * explicit synthetic lot, via balancing LOT_MIGRATION movements (−q at NIL, +q at the lot) so the
   * append-only ledger stays the source of truth. Idempotent: rows already carrying a real lot are skipped.
   */
  async backfillLegacy(organizationId: string, user: RequestUser): Promise<{ migrated: number }> {
    const legacy = await this.prisma.inventoryBalance.findMany({
      where: {
        organizationId,
        lotId: NIL_UUID,
        product: { isBatchTracked: true },
        OR: [
          { onHand: { not: 0 } }, { reserved: { not: 0 } }, { inTransit: { not: 0 } },
          { quarantined: { not: 0 } }, { damaged: { not: 0 } },
        ],
      },
      include: { product: { select: { sku: true } } },
    });
    let migrated = 0;
    for (const b of legacy) {
      const lotNumber = `LEGACY-OPENING-${b.product.sku}`;
      const lot = await this.prisma.inventoryLot.upsert({
        where: { organizationId_productId_variantId_lotNumber: { organizationId, productId: b.productId, variantId: b.variantId, lotNumber } },
        create: { organizationId, productId: b.productId, variantId: b.variantId, lotNumber, origin: 'LEGACY_MIGRATION', attributes: { origin: 'LEGACY_MIGRATION' } },
        update: {},
      });
      const variantId = b.variantId === NIL_UUID ? null : b.variantId;
      const buckets: Array<[keyof BucketDeltas, Prisma.Decimal]> = [
        ['onHand', b.onHand], ['reserved', b.reserved], ['inTransit', b.inTransit], ['quarantined', b.quarantined], ['damaged', b.damaged],
      ];
      for (const [bucket, qty] of buckets) {
        if (qty.equals(0)) continue;
        const mk = (v: Prisma.Decimal): BucketDeltas => ({ onHand: ZERO, reserved: ZERO, inTransit: ZERO, quarantined: ZERO, damaged: ZERO, [bucket]: v });
        // Two balancing legs in one movement set: −q at the NIL grain, +q at the synthetic lot.
        await this.posting.migrate(
          {
            organizationId, actorId: user.userId, bypassLotPolicy: true, reason: 'legacy lot backfill',
            idempotencyKey: `lot_migration:${b.id}:${bucket}`,
          },
          {
            warehouseId: b.warehouseId,
            referenceId: `${lot.id}:${bucket}`,
            lines: [
              { productId: b.productId, variantId, quantity: qty, lotId: null, deltas: mk(qty.neg()) },
              { productId: b.productId, variantId, quantity: qty, lotId: lot.id, deltas: mk(qty) },
            ],
          },
        );
      }
      migrated += 1;
      await this.audit.record({
        organizationId, userId: user.userId, action: 'lot.migrated', entityType: 'lot',
        entityId: lot.id, entityDisplay: lotNumber, warehouseId: b.warehouseId, newValue: { origin: 'LEGACY_MIGRATION' },
      });
    }
    return { migrated };
  }

  // ---- helpers ----

  private toResponse(
    l: LotRow,
    totals?: { onHand: Prisma.Decimal | null; reserved: Prisma.Decimal | null; inTransit: Prisma.Decimal | null; quarantined: Prisma.Decimal | null; damaged: Prisma.Decimal | null } | undefined,
  ): LotResponse {
    const t = (v: Prisma.Decimal | null | undefined) => (v ?? new Prisma.Decimal(0)).toString();
    return {
      id: l.id,
      lotNumber: l.lotNumber,
      productId: l.productId,
      productSku: l.product.sku,
      productName: l.product.name,
      variantId: l.variantId === NIL_UUID ? null : l.variantId,
      manufacturedAt: l.manufacturedAt ? l.manufacturedAt.toISOString() : null,
      expiryDate: l.expiryDate ? l.expiryDate.toISOString() : null,
      receivedAt: l.receivedAt ? l.receivedAt.toISOString() : null,
      supplierId: l.supplierId,
      status: l.status,
      origin: l.origin,
      expiryState: expiryStateOf(l.expiryDate, DEFAULT_EXPIRING_SOON_DAYS, DEFAULT_BUSINESS_TZ),
      createdAt: l.createdAt.toISOString(),
      onHand: t(totals?.onHand),
      reserved: t(totals?.reserved),
      quarantined: t(totals?.quarantined),
      damaged: t(totals?.damaged),
      inTransit: t(totals?.inTransit),
    };
  }
}
