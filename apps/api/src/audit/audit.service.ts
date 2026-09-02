import { Injectable, Logger } from '@nestjs/common';
import type { AuditEntryResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reference?: string;
  ipAddress?: string;
}

/**
 * Writes append-only audit records (Phase 0 §36). Failures are logged but never
 * throw — auditing must not break the business operation it observes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as object),
          newValue: entry.newValue === undefined ? undefined : (entry.newValue as object),
          reference: entry.reference ?? null,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for action "${entry.action}"`, err as Error);
    }
  }

  /** Reads audit entries for the org, optionally scoped to one entity. Newest first. */
  async list(
    organizationId: string,
    filter: { entityType?: string; entityId?: string; action?: string; limit?: number },
  ): Promise<AuditEntryResponse[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.action ? { action: filter.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 50, 200),
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      userId: r.userId,
      oldValue: r.oldValue ?? null,
      newValue: r.newValue ?? null,
      reference: r.reference,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
