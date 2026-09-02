import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditChange, AuditEntryResponse, AuditPage, AuditSource } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context';
import type { RequestUser } from '../common/request-user';

export interface AuditEntry {
  organizationId?: string | null;
  userId?: string | null;
  actorDisplayName?: string | null;
  source?: AuditSource;
  action: string;
  entityType?: string;
  entityId?: string;
  entityDisplay?: string | null;
  warehouseId?: string | null;
  correlationId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reference?: string;
  ipAddress?: string;
}

export interface AuditSearchFilter {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  warehouseId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Key substrings whose values must never be persisted or shown in an audit record. */
const PROTECTED_KEY = /pass|token|secret|credential|authorization|api[_-]?key|private[_-]?key|otp|pin/i;
const REDACTED = '[REDACTED]';
const MAX_VALUE_BYTES = 8_192; // an audit record describes a change; it is not a second DB copy.

/**
 * The audit READ MODEL (2A.1F). Domains call {@link record} to emit facts; the explorer only
 * searches, correlates, filters, and presents them. Writes never throw — auditing must not break
 * the operation it observes — and protected values are redacted before they touch the database.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      const ctx = this.context.get();
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId ?? null,
          userId: entry.userId ?? ctx?.actorId ?? null,
          actorDisplayName: entry.actorDisplayName ?? ctx?.actorDisplayName ?? null,
          source: entry.source ?? ctx?.source ?? 'USER',
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          entityDisplay: entry.entityDisplay ?? null,
          warehouseId: entry.warehouseId ?? null,
          correlationId: entry.correlationId ?? ctx?.correlationId ?? null,
          oldValue: this.sanitize(entry.oldValue),
          newValue: this.sanitize(entry.newValue),
          reference: entry.reference ?? null,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for action "${entry.action}"`, err as Error);
    }
  }

  /** Cursor-paginated, org-isolated, warehouse-scoped search over the audit history. */
  async search(user: RequestUser, filter: AuditSearchFilter): Promise<AuditPage> {
    const scope = this.resolveWarehouseScope(user, filter.warehouseId);
    if (scope === 'DENIED') return { entries: [], nextCursor: null };

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
    const where = this.buildWhere(user.organizationId, filter, scope);

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      entries: page.map((r) => this.toResponse(r)),
      nextCursor: hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Every record produced by one logical operation, oldest-first so it reads as a sequence. */
  async correlation(user: RequestUser, correlationId: string): Promise<AuditEntryResponse[]> {
    const scope = this.resolveWarehouseScope(user, undefined);
    if (scope === 'DENIED') return [];
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: user.organizationId,
        correlationId,
        ...(scope ? { warehouseId: { in: scope } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map((r) => this.toResponse(r));
  }

  /** Entity History drawers read the SAME records as the explorer, just pre-filtered. */
  async forEntity(user: RequestUser, entityType: string, entityId: string, limit = 100): Promise<AuditEntryResponse[]> {
    const page = await this.search(user, { entityType, entityId, limit });
    return page.entries;
  }

  // ---- where / scope helpers ----

  /** null = org-wide; string[] = restricted set; 'DENIED' = filter fell outside the user's scope. */
  private resolveWarehouseScope(user: RequestUser, filterWarehouseId?: string): string[] | null | 'DENIED' {
    if (user.warehouseScope === null) {
      return filterWarehouseId ? [filterWarehouseId] : null;
    }
    if (filterWarehouseId) {
      return user.warehouseScope.includes(filterWarehouseId) ? [filterWarehouseId] : 'DENIED';
    }
    return user.warehouseScope; // scoped users only ever see warehouse-tagged records in their scope
  }

  private buildWhere(
    organizationId: string,
    filter: AuditSearchFilter,
    scope: string[] | null,
  ): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [{ organizationId }];
    if (scope) and.push({ warehouseId: { in: scope } });
    if (filter.actorId) and.push({ userId: filter.actorId });
    if (filter.action) and.push({ action: filter.action });
    if (filter.entityType) and.push({ entityType: filter.entityType });
    if (filter.entityId) and.push({ entityId: filter.entityId });
    if (filter.from || filter.to) {
      and.push({
        createdAt: {
          ...(filter.from ? { gte: new Date(filter.from) } : {}),
          ...(filter.to ? { lte: new Date(filter.to) } : {}),
        },
      });
    }
    if (filter.q) {
      const contains = { contains: filter.q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { action: contains },
          { entityType: contains },
          { entityDisplay: contains },
          { actorDisplayName: contains },
          { reference: contains },
        ],
      });
    }
    const cursor = filter.cursor ? this.decodeCursor(filter.cursor) : null;
    if (cursor) {
      // Keyset pagination, stable even when many rows share a timestamp (tiebreak on id).
      and.push({
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      });
    }
    return { AND: and };
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
    try {
      const [t, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
      if (!t || !id) return null;
      const createdAt = new Date(t);
      if (Number.isNaN(createdAt.getTime())) return null;
      return { createdAt, id };
    } catch {
      return null;
    }
  }

  // ---- mapping ----

  private toResponse(r: {
    id: string; createdAt: Date; userId: string | null; actorDisplayName: string | null;
    source: AuditSource; action: string; entityType: string | null; entityId: string | null;
    entityDisplay: string | null; organizationId: string | null; warehouseId: string | null;
    correlationId: string | null; oldValue: unknown; newValue: unknown; reference: string | null;
  }): AuditEntryResponse {
    return {
      id: r.id,
      occurredAt: r.createdAt.toISOString(),
      actorId: r.userId,
      actorDisplayName: r.actorDisplayName,
      source: r.source,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      entityDisplay: r.entityDisplay,
      organizationId: r.organizationId,
      warehouseId: r.warehouseId,
      correlationId: r.correlationId,
      changes: this.diff(r.oldValue, r.newValue),
      reference: r.reference,
    };
  }

  /** Field-level `{from,to}` diff from the stored old/new snapshots (already redacted at write). */
  private diff(oldValue: unknown, newValue: unknown): Record<string, AuditChange> | null {
    if (!isPlainObject(oldValue) && !isPlainObject(newValue)) return null;
    const from = isPlainObject(oldValue) ? oldValue : {};
    const to = isPlainObject(newValue) ? newValue : {};
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    const changes: Record<string, AuditChange> = {};
    for (const k of keys) {
      const a = from[k];
      const b = to[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: a ?? null, to: b ?? null };
    }
    return Object.keys(changes).length ? changes : null;
  }

  // ---- redaction ----

  private sanitize(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    const redacted = this.redact(value, 0);
    // Cap oversized payloads — the audit record must not become a second uncontrolled DB copy.
    if (Buffer.byteLength(JSON.stringify(redacted) ?? 'null') > MAX_VALUE_BYTES) {
      return { _truncated: true } as Prisma.InputJsonValue;
    }
    return redacted as Prisma.InputJsonValue;
  }

  private redact(value: unknown, depth: number): unknown {
    if (depth > 6 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.redact(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PROTECTED_KEY.test(k) ? REDACTED : this.redact(v, depth + 1);
    }
    return out;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
