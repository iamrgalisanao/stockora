import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  MobileTrackingRequirement,
  MobileWorkClaim,
  MobileWorkItem,
  MobileWorkLine,
  MobileWorkType,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { SerialsService } from '../serials/serials.service';
import { NIL_UUID } from '../inventory/inventory.constants';
import type { RequestUser } from '../common/request-user';

const CLAIM_DEFAULT_LEASE_S = 15 * 60;
const CLAIM_MAX_LEASE_S = 60 * 60;
const SERIAL_CACHE_CAP = 500; // keep offline payloads bounded (ADR 0014 §11/§15)

/**
 * Mobile worklist read models + advisory claims (2D.6B, ADR 0014 §9, §15). Each read model returns ONLY what
 * a scanner workflow needs — document ref, version, warehouse, status, actionable lines with tracking
 * requirements and bounded cached eligibility — never a full desktop payload. Everything is scoped to the
 * caller's organization and warehouse scope; the correctness of any resulting action is still decided by the
 * server command handlers and DB locks (2D.6C), not by these read models or the claims.
 */
@Injectable()
export class MobileWorkService {
  constructor(private readonly prisma: PrismaService, private readonly serials: SerialsService) {}

  private inScope(user: RequestUser, warehouseId: string): boolean {
    return user.warehouseScope === null || user.warehouseScope.includes(warehouseId);
  }

  private scopeWhere(user: RequestUser, field = 'warehouseId'): Record<string, unknown> {
    return user.warehouseScope === null ? {} : { [field]: { in: user.warehouseScope } };
  }

  private version(updatedAt: Date): number {
    return updatedAt.getTime();
  }

  /** Build a productId -> tracking-requirement map for a set of products. */
  private async trackingFor(organizationId: string, productIds: string[]): Promise<Map<string, MobileTrackingRequirement>> {
    const ids = [...new Set(productIds)];
    const map = new Map<string, MobileTrackingRequirement>();
    if (ids.length === 0) return map;
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, isSerialized: true, isBatchTracked: true },
    });
    const policyMap = await this.serials.policyMapFor(organizationId, ids);
    for (const p of products) {
      const policy = policyMap.get(p.id);
      const captureMode = policy?.captureMode ?? 'RECEIPT';
      map.set(p.id, {
        serialized: p.isSerialized,
        serialCaptureAtReceipt: p.isSerialized && captureMode === 'RECEIPT',
        lotTracked: p.isBatchTracked,
        requireLot: p.isBatchTracked && (policy?.requireLotWhenBatchTracked ?? true),
      });
    }
    return map;
  }

  private async claimsFor(organizationId: string, workType: MobileWorkType, documentIds: string[]): Promise<Map<string, MobileWorkClaim>> {
    const map = new Map<string, MobileWorkClaim>();
    if (documentIds.length === 0) return map;
    const rows = await this.prisma.mobileWorkClaim.findMany({
      where: { organizationId, workType, documentId: { in: documentIds } },
    });
    if (rows.length === 0) return map;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.claimedById))] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    for (const r of rows) {
      map.set(r.documentId, {
        documentId: r.documentId,
        workType,
        claimedById: r.claimedById,
        claimedByName: nameById.get(r.claimedById) ?? 'Unknown',
        deviceId: r.deviceId,
        claimedAt: r.claimedAt.toISOString(),
        leaseExpiresAt: r.leaseExpiresAt.toISOString(),
      });
    }
    return map;
  }

  // ---- receiving: receipts still open to receive ----
  async receiving(user: RequestUser): Promise<MobileWorkItem[]> {
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: { organizationId: user.organizationId, status: { in: ['DRAFT', 'RECEIVING', 'PARTIALLY_RECEIVED'] }, ...this.scopeWhere(user) },
      include: { warehouse: { select: { code: true } }, items: { include: { product: { select: { sku: true, name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const tracking = await this.trackingFor(user.organizationId, receipts.flatMap((r) => r.items.map((i) => i.productId)));
    const claims = await this.claimsFor(user.organizationId, 'receiving', receipts.map((r) => r.id));
    return receipts.map((r) => ({
      workType: 'receiving' as const,
      documentId: r.id,
      reference: r.receiptNumber,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      status: r.status,
      version: this.version(r.updatedAt),
      lines: r.items.map<MobileWorkLine>((i) => ({
        lineId: i.id,
        productId: i.productId,
        variantId: i.variantId,
        sku: i.product.sku,
        name: i.product.name,
        targetQty: Number(i.expectedQty),
        tracking: tracking.get(i.productId) ?? defaultTracking(),
      })),
      claim: claims.get(r.id) ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---- releases: approved, ready to pick/issue ----
  async releases(user: RequestUser): Promise<MobileWorkItem[]> {
    const rows = await this.prisma.stockRelease.findMany({
      where: { organizationId: user.organizationId, status: 'APPROVED', ...this.scopeWhere(user) },
      include: {
        warehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true } }, allocations: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const tracking = await this.trackingFor(user.organizationId, rows.flatMap((r) => r.items.map((i) => i.productId)));
    const claims = await this.claimsFor(user.organizationId, 'releases', rows.map((r) => r.id));
    const items: MobileWorkItem[] = [];
    for (const r of rows) {
      const lines: MobileWorkLine[] = [];
      for (const i of r.items) {
        const track = tracking.get(i.productId) ?? defaultTracking();
        const need = Number(i.approvedQty) > 0 ? Number(i.approvedQty) : Number(i.requestedQty);
        lines.push({
          lineId: i.id,
          productId: i.productId,
          variantId: i.variantId,
          sku: i.product.sku,
          name: i.product.name,
          targetQty: need,
          tracking: track,
          eligibleSerials: track.serialized ? await this.eligibleSerials(user.organizationId, i.productId, i.variantId, r.warehouseId) : undefined,
          suggestedAllocation: i.allocations.length
            ? i.allocations.map((a) => ({ lotId: a.lotId, quantity: Number(a.quantity) }))
            : undefined,
        });
      }
      items.push({
        workType: 'releases', documentId: r.id, reference: r.releaseNumber, warehouseId: r.warehouseId,
        warehouseCode: r.warehouse.code, status: r.status, version: this.version(r.updatedAt), lines,
        claim: claims.get(r.id) ?? null, updatedAt: r.updatedAt.toISOString(),
      });
    }
    return items;
  }

  // ---- transfers: split into dispatch (APPROVED@source) and receive (IN_TRANSIT@dest) ----
  async transfers(user: RequestUser): Promise<MobileWorkItem[]> {
    const rows = await this.prisma.stockTransfer.findMany({
      where: {
        organizationId: user.organizationId,
        status: { in: ['APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] },
      },
      include: {
        sourceWarehouse: { select: { code: true } },
        destWarehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const tracking = await this.trackingFor(user.organizationId, rows.flatMap((r) => r.items.map((i) => i.productId)));
    const items: MobileWorkItem[] = [];
    const dispatchIds: string[] = [];
    const receiveIds: string[] = [];
    for (const r of rows) {
      if (r.status === 'APPROVED') dispatchIds.push(r.id);
      else receiveIds.push(r.id);
    }
    const dispatchClaims = await this.claimsFor(user.organizationId, 'transfers', dispatchIds);
    const receiveClaims = await this.claimsFor(user.organizationId, 'transfers', receiveIds);

    for (const r of rows) {
      const isDispatch = r.status === 'APPROVED';
      const wh = isDispatch ? r.sourceWarehouseId : r.destWarehouseId;
      if (!this.inScope(user, wh)) continue; // dispatch is a source-warehouse action; receive a dest-warehouse action
      const lines: MobileWorkLine[] = [];
      for (const i of r.items) {
        const track = tracking.get(i.productId) ?? defaultTracking();
        lines.push({
          lineId: i.id,
          productId: i.productId,
          variantId: i.variantId,
          sku: i.product.sku,
          name: i.product.name,
          targetQty: isDispatch ? Number(i.quantity) : Number(i.qtyDispatched),
          tracking: track,
          // Dispatch: pick from source in-stock. Receive: the EXACT dispatched serial set (no substitution).
          eligibleSerials: !track.serialized
            ? undefined
            : isDispatch
              ? await this.eligibleSerials(user.organizationId, i.productId, i.variantId, r.sourceWarehouseId)
              : i.serialNumbers,
        });
      }
      items.push({
        workType: 'transfers',
        subAction: isDispatch ? 'dispatch' : 'receive',
        documentId: r.id,
        reference: r.transferNumber,
        warehouseId: wh,
        warehouseCode: isDispatch ? r.sourceWarehouse.code : r.destWarehouse.code,
        status: r.status,
        version: this.version(r.updatedAt),
        lines,
        claim: (isDispatch ? dispatchClaims : receiveClaims).get(r.id) ?? null,
        updatedAt: r.updatedAt.toISOString(),
      });
    }
    return items;
  }

  // ---- counts: open counting sessions ----
  async counts(user: RequestUser): Promise<MobileWorkItem[]> {
    const rows = await this.prisma.stockCount.findMany({
      where: { organizationId: user.organizationId, status: 'COUNTING', ...this.scopeWhere(user) },
      include: {
        warehouse: { select: { code: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const tracking = await this.trackingFor(user.organizationId, rows.flatMap((r) => r.items.map((i) => i.productId)));
    const claims = await this.claimsFor(user.organizationId, 'counts', rows.map((r) => r.id));
    return rows.map((r) => ({
      workType: 'counts' as const,
      documentId: r.id,
      reference: r.countNumber,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      status: r.status,
      version: this.version(r.updatedAt),
      blind: r.isBlind,
      lines: r.items.map<MobileWorkLine>((i) => {
        const track = tracking.get(i.productId) ?? defaultTracking();
        return {
          lineId: i.id,
          productId: i.productId,
          variantId: i.variantId,
          sku: i.product.sku,
          name: i.product.name,
          // Blind count: never expose the expected/system quantity while counting (ADR 0009 blind mode).
          targetQty: r.isBlind ? undefined : Number(i.systemQty),
          tracking: track,
          // Serialized expected set is also withheld under a blind count.
          eligibleSerials: track.serialized && !r.isBlind ? i.expectedSerials.slice(0, SERIAL_CACHE_CAP) : undefined,
        };
      }),
      claim: claims.get(r.id) ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---- returns: drafts awaiting intake ----
  async returns(user: RequestUser): Promise<MobileWorkItem[]> {
    const rows = await this.prisma.inventoryReturn.findMany({
      where: { organizationId: user.organizationId, status: 'DRAFT', ...this.scopeWhere(user) },
      include: {
        warehouse: { select: { code: true } },
        lines: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const tracking = await this.trackingFor(user.organizationId, rows.flatMap((r) => r.lines.map((l) => l.productId)));
    const claims = await this.claimsFor(user.organizationId, 'returns', rows.map((r) => r.id));
    return rows.map((r) => ({
      workType: 'returns' as const,
      documentId: r.id,
      reference: r.returnNo,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouse.code,
      status: r.status,
      version: this.version(r.createdAt),
      lines: r.lines.map<MobileWorkLine>((l) => {
        const track = tracking.get(l.productId) ?? defaultTracking();
        return {
          lineId: l.id,
          productId: l.productId,
          variantId: l.variantId === NIL_UUID ? null : l.variantId,
          sku: l.product.sku,
          name: l.product.name,
          targetQty: Number(l.quantity),
          tracking: track,
          // The exact serials declared for return — the operator verifies these, no substitution.
          eligibleSerials: track.serialized && l.serialNumbers.length ? l.serialNumbers : undefined,
        };
      }),
      claim: claims.get(r.id) ?? null,
      updatedAt: r.createdAt.toISOString(),
    }));
  }

  private async eligibleSerials(organizationId: string, productId: string, variantId: string | null, warehouseId: string): Promise<string[]> {
    const list = await this.serials.inStockSerials(organizationId, productId, variantId ?? NIL_UUID, warehouseId, null);
    return list.slice(0, SERIAL_CACHE_CAP);
  }

  // ---- claims (advisory) ----
  async claim(user: RequestUser, workType: MobileWorkType, documentId: string, deviceId: string, leaseSeconds?: number): Promise<MobileWorkClaim> {
    await this.assertDocumentInScope(user, workType, documentId);
    const lease = Math.min(Math.max(leaseSeconds ?? CLAIM_DEFAULT_LEASE_S, 1), CLAIM_MAX_LEASE_S);
    const leaseExpiresAt = new Date(Date.now() + lease * 1000);
    // Upsert: a supervisor / new operator take-over overwrites the prior holder. Advisory only (ADR 0014 §9).
    await this.prisma.mobileWorkClaim.upsert({
      where: { organizationId_workType_documentId: { organizationId: user.organizationId, workType, documentId } },
      create: { organizationId: user.organizationId, workType, documentId, claimedById: user.userId, deviceId, leaseExpiresAt },
      update: { claimedById: user.userId, deviceId, claimedAt: new Date(), leaseExpiresAt },
    });
    return {
      documentId, workType, claimedById: user.userId, claimedByName: user.name, deviceId,
      claimedAt: new Date().toISOString(), leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
  }

  async releaseClaim(user: RequestUser, workType: MobileWorkType, documentId: string): Promise<void> {
    const existing = await this.prisma.mobileWorkClaim.findUnique({
      where: { organizationId_workType_documentId: { organizationId: user.organizationId, workType, documentId } },
    });
    if (!existing) return;
    // Only the holder releases their own claim here; supervisor take-over uses claim() to overwrite.
    if (existing.claimedById !== user.userId) throw new ForbiddenException('This work is claimed by another operator');
    await this.prisma.mobileWorkClaim.delete({ where: { id: existing.id } });
  }

  /** Validate a claim target exists, belongs to the org, and its relevant warehouse is in the caller's scope. */
  private async assertDocumentInScope(user: RequestUser, workType: MobileWorkType, documentId: string): Promise<void> {
    let warehouseId: string | null = null;
    switch (workType) {
      case 'receiving':
        warehouseId = (await this.prisma.goodsReceipt.findFirst({ where: { id: documentId, organizationId: user.organizationId }, select: { warehouseId: true } }))?.warehouseId ?? null;
        break;
      case 'releases':
        warehouseId = (await this.prisma.stockRelease.findFirst({ where: { id: documentId, organizationId: user.organizationId }, select: { warehouseId: true } }))?.warehouseId ?? null;
        break;
      case 'transfers': {
        const t = await this.prisma.stockTransfer.findFirst({ where: { id: documentId, organizationId: user.organizationId }, select: { sourceWarehouseId: true, destWarehouseId: true } });
        // Either endpoint being in scope is enough to claim the transfer.
        if (t && (this.inScope(user, t.sourceWarehouseId) || this.inScope(user, t.destWarehouseId))) return;
        if (!t) throw new NotFoundException('Work item not found');
        throw new ForbiddenException('Work item is outside your warehouse scope');
      }
      case 'counts':
        warehouseId = (await this.prisma.stockCount.findFirst({ where: { id: documentId, organizationId: user.organizationId }, select: { warehouseId: true } }))?.warehouseId ?? null;
        break;
      case 'returns':
        warehouseId = (await this.prisma.inventoryReturn.findFirst({ where: { id: documentId, organizationId: user.organizationId }, select: { warehouseId: true } }))?.warehouseId ?? null;
        break;
      default:
        throw new BadRequestException('Unknown work type');
    }
    if (warehouseId === null) throw new NotFoundException('Work item not found');
    if (!this.inScope(user, warehouseId)) throw new ForbiddenException('Work item is outside your warehouse scope');
  }
}

function defaultTracking(): MobileTrackingRequirement {
  return { serialized: false, serialCaptureAtReceipt: false, lotTracked: false, requireLot: false };
}
