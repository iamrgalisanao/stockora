import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  MobileApplyStatus,
  MobileCommandReceipt,
  MobileCommandType,
  MobileConflictCode,
  MobileRejectionCode,
  MobileResolution,
  PermissionCode,
  ReceiveCommandPayload,
  ReleasePickCommandPayload,
  ReturnReceiveCommandPayload,
  CountSubmitCommandPayload,
  TransferDispatchCommandPayload,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { COMMAND_SCHEMA_VERSION, MIN_APP_VERSION } from '../common/mobile.constants';
import type { RequestUser } from '../common/request-user';
import { ReceivingService } from '../receiving/receiving.service';
import { ReleasesService } from '../releases/releases.service';
import { TransfersService } from '../transfers/transfers.service';
import { CountsService } from '../counts/counts.service';
import { ReturnsService } from '../returns/returns.service';
import type { SubmitCommandDto } from './dto/mobile.dto';

const COMMAND_PERMISSION: Record<MobileCommandType, PermissionCode> = {
  RECEIVE: 'inventory.receive',
  RELEASE_PICK: 'inventory.release',
  TRANSFER_DISPATCH: 'inventory.transfer',
  TRANSFER_RECEIVE: 'inventory.transfer',
  COUNT_SUBMIT: 'inventory.count',
  RETURN_RECEIVE: 'return.receive',
};

/** Result of an apply attempt: APPLIED with the new version, or a classified conflict/rejection. */
type ApplyOutcome =
  | { status: 'APPLIED'; versionAfter: number }
  | { status: 'CONFLICT' | 'REJECTED'; code: MobileConflictCode | MobileRejectionCode; resolution: MobileResolution; message: string; currentState?: Record<string, unknown> };

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const TERMINAL = new Set(['APPLIED', 'CONFLICT', 'REJECTED']);

/**
 * Mobile command sync + conflict engine (2D.6C, ADR 0014). A queued command is revalidated against current
 * authoritative state and either APPLIED through the EXISTING inventory domain services (never reimplemented,
 * so mobile and desktop cannot diverge) or turned into an explicit, actionable CONFLICT/REJECTED.
 *
 * Exactly-once holds on three legs: (1) a terminal receipt for the idempotency key short-circuits any retry;
 * (2) an optimistic version check on first attempt turns a losing concurrent command into a CONFLICT; and
 * (3) the domain services are themselves idempotent + lock-guarded, so even the crash window between a domain
 * commit and receipt write cannot double-apply. No external calls happen inside the domain transactions —
 * the processor only orchestrates local domain work.
 */
@Injectable()
export class MobileCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receiving: ReceivingService,
    private readonly releases: ReleasesService,
    private readonly transfers: TransfersService,
    private readonly counts: CountsService,
    private readonly returns: ReturnsService,
  ) {}

  async submit(user: RequestUser, dto: SubmitCommandDto): Promise<MobileCommandReceipt> {
    // 1. Compatibility gates (REJECTED — never auto-retried).
    if (dto.schemaVersion !== COMMAND_SCHEMA_VERSION) {
      return this.reject(dto, 'SCHEMA_UNSUPPORTED', `Unsupported command schema ${dto.schemaVersion}; server expects ${COMMAND_SCHEMA_VERSION}`);
    }
    if (compareVersions(dto.appVersion, MIN_APP_VERSION) < 0) {
      return this.reject(dto, 'SCHEMA_UNSUPPORTED', `App build ${dto.appVersion} is below the minimum ${MIN_APP_VERSION}; please update`);
    }
    const perm = COMMAND_PERMISSION[dto.commandType];
    if (!perm) return this.reject(dto, 'INVALID_PAYLOAD', `Unknown command type ${dto.commandType}`);

    // 2. Exactly-once: a terminal receipt for this key ends the story (SUBMISSION_UNKNOWN retry lands here).
    const existing = await this.prisma.mobileCommand.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: user.organizationId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing && TERMINAL.has(existing.applyStatus)) return this.toReceipt(existing, true);
    const isRetry = !!existing; // a non-terminal row means a prior attempt of THIS exact command

    // 3. Current authorization (REJECTED).
    if (!user.permissions.includes(perm)) return this.persistReject(user, dto, 'PERMISSION_REVOKED', `Missing permission ${perm}`, existing);
    if (user.warehouseScope !== null && !user.warehouseScope.includes(dto.warehouseId)) {
      return this.persistReject(user, dto, 'WAREHOUSE_SCOPE_REVOKED', 'Command targets a warehouse outside your scope', existing);
    }

    // Every command targets a document; a missing/blank aggregate is a malformed command (never fuzzy-match).
    if (!dto.aggregateId) return this.persistReject(user, dto, 'INVALID_PAYLOAD', 'Command is missing its target document', existing);

    // 4. Intake row (ACKNOWLEDGED) if new.
    const row = existing ?? (await this.intake(user, dto));

    // 5. Dependency chain: a command whose predecessor has not APPLIED is BLOCKED (non-terminal — retryable).
    if (dto.dependsOnCommandId) {
      const dep = await this.prisma.mobileCommand.findFirst({
        where: { organizationId: user.organizationId, id: dto.dependsOnCommandId },
        select: { applyStatus: true },
      });
      if (!dep || dep.applyStatus !== 'APPLIED') {
        await this.prisma.mobileCommand.update({ where: { id: row.id }, data: { applyStatus: 'BLOCKED' } });
        return { commandId: row.id, idempotencyKey: dto.idempotencyKey, status: 'BLOCKED', replay: false, aggregateId: dto.aggregateId, acceptedAt: new Date().toISOString() };
      }
    }

    // 6. Optimistic concurrency — only on a FIRST attempt. A retry of our own command skips this (its version
    //    may have moved because WE applied it), relying on the idempotent adapter + domain guards instead.
    if (!isRetry && dto.aggregateId && dto.expectedVersion !== undefined) {
      const current = await this.currentVersion(user.organizationId, dto.commandType, dto.aggregateId);
      if (current === null) return this.persistReject(user, dto, 'ENTITY_ARCHIVED', 'The target document no longer exists', row);
      if (current !== dto.expectedVersion) {
        return this.persistOutcome(row.id, dto, { status: 'CONFLICT', code: this.stateChangedCode(dto.commandType), resolution: 'REFRESH', message: 'The document changed since it was captured.' });
      }
    }

    // 7. Apply through the existing domain services; classify any failure.
    let outcome: ApplyOutcome;
    try {
      outcome = await this.apply(user, dto);
    } catch (e) {
      if (e instanceof HttpException) outcome = this.classify(e, dto);
      // A malformed id / bad shape reaches Prisma as a validation error — reject it, don't 500.
      else if (e instanceof Prisma.PrismaClientValidationError || e instanceof Prisma.PrismaClientKnownRequestError) {
        outcome = this.rejectOutcome('INVALID_PAYLOAD', 'The command referenced an invalid document or value');
      } else throw e; // a genuine server error — surfaces as 500 so the client keeps the command QUEUED (unknown)
    }
    // Bounded current-state: on a shortage, tell the operator what IS available (never silently reduce qty).
    if (outcome.status === 'CONFLICT' && outcome.code === 'INSUFFICIENT_STOCK' && !outcome.currentState) {
      const state = await this.availabilityState(user.organizationId, dto).catch(() => undefined);
      if (state) outcome = { ...outcome, currentState: state };
    }
    return this.persistOutcome(row.id, dto, outcome);
  }

  // -------------------------------------------------------------------------
  // Apply adapters — translate the mobile payload into existing domain calls.
  // -------------------------------------------------------------------------

  private async apply(user: RequestUser, dto: SubmitCommandDto): Promise<ApplyOutcome> {
    const org = user.organizationId;
    switch (dto.commandType) {
      case 'RECEIVE': {
        const receipt = await this.prisma.goodsReceipt.findFirst({ where: { id: dto.aggregateId, organizationId: org }, include: { items: true } });
        if (!receipt) return this.rejectOutcome('ENTITY_ARCHIVED', 'Receipt not found');
        if (receipt.postedAt) return { status: 'APPLIED', versionAfter: receipt.updatedAt.getTime() }; // idempotent
        const payload = dto.payload as unknown as ReceiveCommandPayload;
        const byLine = new Map(payload.lines.map((l) => [l.lineId, l]));
        const items = receipt.items.map((it) => {
          const cap = byLine.get(it.id);
          return {
            productId: it.productId,
            variantId: it.variantId ?? undefined,
            expectedQty: Number(it.expectedQty),
            receivedQty: cap ? cap.quantity : Number(it.receivedQty),
            unitCost: Number(it.unitCost),
            batchNumber: cap?.batchNumber ?? it.batchNumber ?? undefined,
            expiryDate: cap?.expiryDate ?? (it.expiryDate ? it.expiryDate.toISOString() : undefined),
            locationId: it.locationId ?? undefined,
            serialNumbers: cap?.serialNumbers ?? it.serialNumbers,
          };
        });
        await this.receiving.update(org, user, receipt.id, { items });
        await this.receiving.post(org, user, receipt.id);
        return { status: 'APPLIED', versionAfter: await this.reloadVersion('RECEIVE', org, receipt.id) };
      }
      case 'RELEASE_PICK': {
        const rel = await this.prisma.stockRelease.findFirst({ where: { id: dto.aggregateId, organizationId: org } });
        if (!rel) return this.rejectOutcome('ENTITY_ARCHIVED', 'Release not found');
        if (rel.status === 'RELEASED') return { status: 'APPLIED', versionAfter: rel.updatedAt.getTime() }; // idempotent
        const payload = dto.payload as unknown as ReleasePickCommandPayload;
        const serialInputs = payload.lines.filter((l) => (l.serialNumbers?.length ?? 0) > 0).map((l) => ({ itemId: l.lineId, serialNumbers: l.serialNumbers! }));
        await this.releases.post(org, user, rel.id, undefined, undefined, serialInputs.length ? serialInputs : undefined);
        return { status: 'APPLIED', versionAfter: await this.reloadVersion('RELEASE_PICK', org, rel.id) };
      }
      case 'TRANSFER_DISPATCH': {
        const tr = await this.prisma.stockTransfer.findFirst({ where: { id: dto.aggregateId, organizationId: org } });
        if (!tr) return this.rejectOutcome('ENTITY_ARCHIVED', 'Transfer not found');
        if (tr.status !== 'APPROVED') return { status: 'APPLIED', versionAfter: tr.updatedAt.getTime() }; // already dispatched (idempotent)
        const payload = dto.payload as unknown as TransferDispatchCommandPayload;
        const serialInputs = payload.lines.filter((l) => (l.serialNumbers?.length ?? 0) > 0).map((l) => ({ itemId: l.itemId, serialNumbers: l.serialNumbers! }));
        await this.transfers.dispatch(org, user, tr.id, `mobile_dispatch:${tr.id}`, serialInputs.length ? serialInputs : undefined);
        return { status: 'APPLIED', versionAfter: await this.reloadVersion('TRANSFER_DISPATCH', org, tr.id) };
      }
      case 'TRANSFER_RECEIVE': {
        const tr = await this.prisma.stockTransfer.findFirst({ where: { id: dto.aggregateId, organizationId: org } });
        if (!tr) return this.rejectOutcome('ENTITY_ARCHIVED', 'Transfer not found');
        if (tr.receivedAt) return { status: 'APPLIED', versionAfter: tr.updatedAt.getTime() }; // idempotent
        await this.transfers.receive(org, user, tr.id, `mobile_receive:${tr.id}`);
        return { status: 'APPLIED', versionAfter: await this.reloadVersion('TRANSFER_RECEIVE', org, tr.id) };
      }
      case 'COUNT_SUBMIT': {
        const count = await this.prisma.stockCount.findFirst({ where: { id: dto.aggregateId, organizationId: org } });
        if (!count) return this.rejectOutcome('ENTITY_ARCHIVED', 'Count not found');
        if (count.status !== 'COUNTING') return { status: 'APPLIED', versionAfter: count.updatedAt.getTime() }; // already submitted (idempotent)
        const payload = dto.payload as unknown as CountSubmitCommandPayload;
        await this.counts.enterCounts(org, user, count.id, { items: payload.entries });
        await this.counts.submit(org, user, count.id); // COUNTING -> REVIEW (posting stays a supervisor action)
        return { status: 'APPLIED', versionAfter: await this.reloadVersion('COUNT_SUBMIT', org, count.id) };
      }
      case 'RETURN_RECEIVE': {
        const ret = await this.prisma.inventoryReturn.findFirst({ where: { id: dto.aggregateId, organizationId: org } });
        if (!ret) return this.rejectOutcome('ENTITY_ARCHIVED', 'Return not found');
        if (ret.receivedAt) return { status: 'APPLIED', versionAfter: ret.createdAt.getTime() }; // idempotent
        const payload = dto.payload as unknown as ReturnReceiveCommandPayload;
        await this.returns.receive(org, user, ret.id, payload.lines ? { lines: payload.lines } : {});
        return { status: 'APPLIED', versionAfter: ret.createdAt.getTime() };
      }
      default:
        return this.rejectOutcome('INVALID_PAYLOAD', 'Unsupported command type');
    }
  }

  // -------------------------------------------------------------------------
  // Classification + bounded current-state reads
  // -------------------------------------------------------------------------

  private classify(e: HttpException, dto: SubmitCommandDto): ApplyOutcome {
    const msg = e.message || 'Rejected';
    if (e instanceof NotFoundException) return this.rejectOutcome('ENTITY_ARCHIVED', msg);
    if (e instanceof ForbiddenException) {
      if (/scope|not have access|warehouse/i.test(msg)) return this.rejectOutcome('WAREHOUSE_SCOPE_REVOKED', msg);
      // The negative-stock guard throws ForbiddenException ("Insufficient stock: ...").
      return { status: 'CONFLICT', code: 'INSUFFICIENT_STOCK', resolution: 'REFRESH', message: msg };
    }
    if (e instanceof ConflictException) {
      return { status: 'CONFLICT', code: this.stateChangedCode(dto.commandType), resolution: 'REFRESH', message: msg };
    }
    if (e instanceof BadRequestException) {
      if (/serial/i.test(msg)) {
        const code: MobileConflictCode = /issued/i.test(msg) ? 'SERIAL_ALREADY_ISSUED' : 'SERIAL_WRONG_STATE';
        const sn = /Serial (\S+)/i.exec(msg)?.[1];
        return { status: 'CONFLICT', code, resolution: 'RESCAN', message: msg, currentState: sn ? { serialNumber: sn } : undefined };
      }
      if (/fefo/i.test(msg)) return { status: 'CONFLICT', code: 'FEFO_ALLOCATION_STALE', resolution: 'REALLOCATE', message: msg };
      if (/lot/i.test(msg)) return { status: 'CONFLICT', code: 'LOT_ALLOCATION_STALE', resolution: 'REALLOCATE', message: msg };
      if (/insufficient|stock|available|negative/i.test(msg)) return { status: 'CONFLICT', code: 'INSUFFICIENT_STOCK', resolution: 'REFRESH', message: msg };
      if (/draft|cannot be|already|status|state/i.test(msg)) return { status: 'CONFLICT', code: this.stateChangedCode(dto.commandType), resolution: 'REFRESH', message: msg };
      // A structurally invalid command should not be blindly retried.
      return this.rejectOutcome('INVALID_PAYLOAD', msg);
    }
    // Any other HttpException: treat as a recoverable document conflict rather than a terminal rejection.
    return { status: 'CONFLICT', code: 'DOCUMENT_STALE', resolution: 'REFRESH', message: msg };
  }

  private stateChangedCode(type: MobileCommandType): MobileConflictCode {
    if (type === 'TRANSFER_DISPATCH' || type === 'TRANSFER_RECEIVE') return 'TRANSFER_STATE_CHANGED';
    if (type === 'COUNT_SUBMIT') return 'COUNT_STATE_CHANGED';
    return 'DOCUMENT_STALE';
  }

  /** Read available (on_hand − reserved − quarantined) for a product at a warehouse — bounded currentState. */
  private async readAvailable(org: string, productId: string, warehouseId: string): Promise<number> {
    const rows = await this.prisma.inventoryBalance.findMany({ where: { organizationId: org, productId, warehouseId }, select: { onHand: true, reserved: true, quarantined: true } });
    return rows.reduce((s, r) => s + (Number(r.onHand) - Number(r.reserved) - Number(r.quarantined)), 0);
  }

  /** Bounded availability snapshot for a shortage conflict — the current available per line product. */
  private async availabilityState(org: string, dto: SubmitCommandDto): Promise<Record<string, unknown> | undefined> {
    if (dto.commandType === 'RELEASE_PICK') {
      const rel = await this.prisma.stockRelease.findFirst({ where: { id: dto.aggregateId, organizationId: org }, include: { items: { take: 20, select: { productId: true } } } });
      if (!rel) return undefined;
      const lines = await Promise.all(rel.items.map(async (i) => ({ productId: i.productId, available: await this.readAvailable(org, i.productId, rel.warehouseId) })));
      return lines.length === 1 ? { available: lines[0]!.available } : { lines };
    }
    if (dto.commandType === 'TRANSFER_DISPATCH') {
      const tr = await this.prisma.stockTransfer.findFirst({ where: { id: dto.aggregateId, organizationId: org }, include: { items: { take: 20, select: { productId: true } } } });
      if (!tr) return undefined;
      const lines = await Promise.all(tr.items.map(async (i) => ({ productId: i.productId, available: await this.readAvailable(org, i.productId, tr.sourceWarehouseId) })));
      return lines.length === 1 ? { available: lines[0]!.available } : { lines };
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Version + persistence
  // -------------------------------------------------------------------------

  private async currentVersion(org: string, type: MobileCommandType, aggregateId: string): Promise<number | null> {
    return this.reloadVersion(type, org, aggregateId).catch(() => null);
  }

  private async reloadVersion(type: MobileCommandType, org: string, id: string): Promise<number> {
    switch (type) {
      case 'RECEIVE': {
        const r = await this.prisma.goodsReceipt.findFirst({ where: { id, organizationId: org }, select: { updatedAt: true } });
        if (!r) throw new NotFoundException('Receipt not found');
        return r.updatedAt.getTime();
      }
      case 'RELEASE_PICK': {
        const r = await this.prisma.stockRelease.findFirst({ where: { id, organizationId: org }, select: { updatedAt: true } });
        if (!r) throw new NotFoundException('Release not found');
        return r.updatedAt.getTime();
      }
      case 'TRANSFER_DISPATCH':
      case 'TRANSFER_RECEIVE': {
        const r = await this.prisma.stockTransfer.findFirst({ where: { id, organizationId: org }, select: { updatedAt: true } });
        if (!r) throw new NotFoundException('Transfer not found');
        return r.updatedAt.getTime();
      }
      case 'COUNT_SUBMIT': {
        const r = await this.prisma.stockCount.findFirst({ where: { id, organizationId: org }, select: { updatedAt: true } });
        if (!r) throw new NotFoundException('Count not found');
        return r.updatedAt.getTime();
      }
      case 'RETURN_RECEIVE': {
        const r = await this.prisma.inventoryReturn.findFirst({ where: { id, organizationId: org }, select: { createdAt: true } });
        if (!r) throw new NotFoundException('Return not found');
        return r.createdAt.getTime();
      }
    }
  }

  private rejectOutcome(code: MobileRejectionCode, message: string): ApplyOutcome {
    return { status: 'REJECTED', code, resolution: 'DISCARD_LOCAL_COMMAND', message };
  }

  private async intake(user: RequestUser, dto: SubmitCommandDto) {
    try {
      return await this.prisma.mobileCommand.create({
        data: {
          id: dto.commandId,
          organizationId: user.organizationId,
          idempotencyKey: dto.idempotencyKey,
          deviceId: dto.deviceId,
          userId: user.userId,
          warehouseId: dto.warehouseId,
          commandType: dto.commandType,
          aggregateId: dto.aggregateId ?? null,
          expectedVersion: dto.expectedVersion !== undefined ? BigInt(dto.expectedVersion) : null,
          dependsOnCommandId: dto.dependsOnCommandId ?? null,
          schemaVersion: dto.schemaVersion,
          appVersion: dto.appVersion,
          payload: dto.payload as Prisma.InputJsonValue,
          capturedAt: new Date(dto.capturedAt),
        },
      });
    } catch (e) {
      // Concurrent intake of the same key — re-read the winning row.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await this.prisma.mobileCommand.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: user.organizationId, idempotencyKey: dto.idempotencyKey } },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  private async persistOutcome(id: string, dto: SubmitCommandDto, outcome: ApplyOutcome): Promise<MobileCommandReceipt> {
    // Enrich INSUFFICIENT_STOCK with a bounded availability read where we can attribute a single product.
    let currentState = outcome.status !== 'APPLIED' ? outcome.currentState : undefined;
    const status: MobileApplyStatus = outcome.status;
    const row = await this.prisma.mobileCommand.update({
      where: { id },
      data: {
        applyStatus: status,
        code: outcome.status === 'APPLIED' ? null : outcome.code,
        message: outcome.status === 'APPLIED' ? null : outcome.message,
        resolution: outcome.status === 'APPLIED' ? null : outcome.resolution,
        currentState: (currentState ?? undefined) as Prisma.InputJsonValue | undefined,
        aggregateVersionAfter: outcome.status === 'APPLIED' ? BigInt(outcome.versionAfter) : null,
        appliedAt: outcome.status === 'APPLIED' ? new Date() : null,
      },
    });
    return this.toReceipt(row, false);
  }

  private async persistReject(user: RequestUser, dto: SubmitCommandDto, code: MobileRejectionCode, message: string, existing: { id: string } | null): Promise<MobileCommandReceipt> {
    const row = existing ?? (await this.intake(user, dto));
    return this.persistOutcome(row.id, dto, { status: 'REJECTED', code, resolution: code === 'PERMISSION_REVOKED' || code === 'WAREHOUSE_SCOPE_REVOKED' ? 'SUPERVISOR_REVIEW' : 'DISCARD_LOCAL_COMMAND', message });
  }

  /** A pre-intake rejection (compat gates) — no row is created; the client will not retry a REJECTED command. */
  private reject(dto: SubmitCommandDto, code: MobileRejectionCode, message: string): MobileCommandReceipt {
    return {
      commandId: dto.commandId,
      idempotencyKey: dto.idempotencyKey,
      status: 'REJECTED',
      replay: false,
      code,
      resolution: 'DISCARD_LOCAL_COMMAND',
      message,
      aggregateId: dto.aggregateId,
      acceptedAt: new Date().toISOString(),
    };
  }

  private toReceipt(row: {
    id: string; idempotencyKey: string; applyStatus: string; code: string | null; message: string | null;
    resolution: string | null; currentState: Prisma.JsonValue | null; aggregateId: string | null;
    aggregateVersionAfter: bigint | null; receivedAt: Date; appliedAt: Date | null;
  }, replay: boolean): MobileCommandReceipt {
    return {
      commandId: row.id,
      idempotencyKey: row.idempotencyKey,
      status: row.applyStatus as MobileApplyStatus,
      replay,
      code: (row.code ?? undefined) as MobileConflictCode | MobileRejectionCode | undefined,
      message: row.message ?? undefined,
      resolution: (row.resolution ?? undefined) as MobileResolution | undefined,
      currentState: (row.currentState ?? undefined) as Record<string, unknown> | undefined,
      aggregateId: row.aggregateId ?? undefined,
      aggregateVersionAfter: row.aggregateVersionAfter !== null ? Number(row.aggregateVersionAfter) : undefined,
      acceptedAt: (row.appliedAt ?? row.receivedAt).toISOString(),
    };
  }
}
