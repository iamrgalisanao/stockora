import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LotOrigin, LotResponse, LotStockRow } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryPostingService, type StockLine } from '../inventory/inventory-posting.service';
import type { RequestUser } from '../common/request-user';
import { BucketDeltas, D, NIL_UUID, ZERO } from '../inventory/inventory.constants';

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
}

export interface ResolveLotInput {
  lotNumber?: string;
  manufacturedAt?: string | null;
  expiryDate?: string | null;
  supplierId?: string | null;
}

export interface LotListFilter {
  productId?: string;
  status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  q?: string;
}

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
      return existing.id;
    }

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
    return lots.map((l) => this.toResponse(l, totals.get(l.id)));
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
      createdAt: l.createdAt.toISOString(),
      onHand: t(totals?.onHand),
      reserved: t(totals?.reserved),
      quarantined: t(totals?.quarantined),
      damaged: t(totals?.damaged),
      inTransit: t(totals?.inTransit),
    };
  }
}
