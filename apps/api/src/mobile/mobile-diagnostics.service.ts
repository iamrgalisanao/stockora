import { Injectable } from '@nestjs/common';
import type { MobileDiagnostics } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

/**
 * Mobile sync health for support (2D.6D, ADR 0014). A bounded, org-scoped aggregate over the command intake
 * journal so an admin can answer "which device, which user, what happened, when did it last sync" without
 * exposing inventory or cost detail. Read-only; never mutates.
 */
@Injectable()
export class MobileDiagnosticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: RequestUser): Promise<MobileDiagnostics> {
    const org = user.organizationId;
    const rows = await this.prisma.mobileCommand.findMany({
      where: { organizationId: org },
      select: { applyStatus: true, code: true, deviceId: true, capturedAt: true, appliedAt: true },
      take: 10000,
    });

    const totals = { received: rows.length, applied: 0, conflict: 0, rejected: 0, acknowledged: 0, blocked: 0 };
    const conflictsByCode: Record<string, number> = {};
    const rejectionsByCode: Record<string, number> = {};
    const devices = new Map<string, { deviceId: string; applied: number; conflict: number; rejected: number; lastAppliedAt: Date | null }>();
    let lastAppliedAt: Date | null = null;
    let oldestUnappliedAt: Date | null = null;
    let latencySum = 0;
    let latencyCount = 0;

    for (const r of rows) {
      const d = devices.get(r.deviceId) ?? { deviceId: r.deviceId, applied: 0, conflict: 0, rejected: 0, lastAppliedAt: null };
      switch (r.applyStatus) {
        case 'APPLIED':
          totals.applied += 1; d.applied += 1;
          if (r.appliedAt) {
            if (!lastAppliedAt || r.appliedAt > lastAppliedAt) lastAppliedAt = r.appliedAt;
            if (!d.lastAppliedAt || r.appliedAt > d.lastAppliedAt) d.lastAppliedAt = r.appliedAt;
            latencySum += r.appliedAt.getTime() - r.capturedAt.getTime();
            latencyCount += 1;
          }
          break;
        case 'CONFLICT':
          totals.conflict += 1; d.conflict += 1;
          if (r.code) conflictsByCode[r.code] = (conflictsByCode[r.code] ?? 0) + 1;
          break;
        case 'REJECTED':
          totals.rejected += 1; d.rejected += 1;
          if (r.code) rejectionsByCode[r.code] = (rejectionsByCode[r.code] ?? 0) + 1;
          break;
        case 'BLOCKED':
          totals.blocked += 1;
          if (!oldestUnappliedAt || r.capturedAt < oldestUnappliedAt) oldestUnappliedAt = r.capturedAt;
          break;
        default: // ACKNOWLEDGED (received, not yet applied)
          totals.acknowledged += 1;
          if (!oldestUnappliedAt || r.capturedAt < oldestUnappliedAt) oldestUnappliedAt = r.capturedAt;
      }
      devices.set(r.deviceId, d);
    }

    return {
      generatedAt: new Date().toISOString(),
      totals,
      conflictsByCode,
      rejectionsByCode,
      lastAppliedAt: lastAppliedAt ? (lastAppliedAt as Date).toISOString() : null,
      oldestUnappliedAt: oldestUnappliedAt ? (oldestUnappliedAt as Date).toISOString() : null,
      avgApplyLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
      devices: [...devices.values()]
        .sort((a, b) => (b.lastAppliedAt?.getTime() ?? 0) - (a.lastAppliedAt?.getTime() ?? 0))
        .slice(0, 100)
        .map((d) => ({ deviceId: d.deviceId, applied: d.applied, conflict: d.conflict, rejected: d.rejected, lastAppliedAt: d.lastAppliedAt ? d.lastAppliedAt.toISOString() : null })),
    };
  }
}
