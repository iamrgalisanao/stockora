import { Injectable } from '@nestjs/common';
import type { NotificationSeverity } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { DomainEventEnvelope } from '../outbox/consumer';

export interface NotificationPlan {
  ruleKey: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  warehouseId: string | null;
  recipientUserIds: string[];
}

/**
 * Explicit notification routing (ADR 0011 §4-5) — no rule DSL. Maps a domain event to who should know,
 * with what severity, and the snapshotted title/message. Recipients are resolved within the event's org and
 * honor warehouse scope; only ACTIVE members are eligible for NEW notifications (§10).
 */
@Injectable()
export class NotificationRuleEngine {
  constructor(private readonly prisma: PrismaService) {}

  async plan(event: DomainEventEnvelope): Promise<NotificationPlan | null> {
    const p = event.payload as Record<string, unknown>;
    const str = (k: string) => (p[k] == null ? null : String(p[k]));
    const org = event.organizationId;

    switch (event.eventType) {
      case 'LotExpiringSoon':
      case 'LotExpired': {
        const warehouseId = str('warehouseId');
        const expired = event.eventType === 'LotExpired';
        const lot = str('lotNumber') ?? 'lot';
        const recipientUserIds = await this.byRole(org, ['warehouse_manager', 'inventory_manager'], warehouseId);
        return {
          ruleKey: event.eventType,
          type: event.eventType,
          severity: expired ? 'CRITICAL' : 'WARNING',
          title: expired ? 'Lot expired' : 'Lot expiring soon',
          message: expired
            ? `Lot ${lot} has expired.`
            : `Lot ${lot} is expiring soon (${str('daysRemaining') ?? '?'} day(s) left).`,
          entityType: 'lot',
          entityId: str('lotId'),
          warehouseId,
          recipientUserIds,
        };
      }
      case 'CycleCountCompleted': {
        const warehouseId = str('warehouseId');
        const managers = await this.byRole(org, ['warehouse_manager'], warehouseId);
        const assignee = str('assignedToId');
        const recipients = new Set(managers);
        if (assignee && (await this.isActive(org, assignee))) recipients.add(assignee);
        const recipientUserIds = [...recipients];
        return {
          ruleKey: event.eventType,
          type: event.eventType,
          severity: 'INFO',
          title: 'Cycle count completed',
          message: `Cycle count completed with variance ${str('varianceQuantity') ?? '0'}.`,
          entityType: 'cycle_count_task',
          entityId: str('cycleCountTaskId'),
          warehouseId,
          recipientUserIds,
        };
      }
      default:
        return null; // no rule → no notification
    }
  }

  /** Active members with a matching role whose warehouse scope covers `warehouseId` (empty scope = all). */
  private async byRole(organizationId: string, roleKeys: string[], warehouseId: string | null): Promise<string[]> {
    const members = await this.prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE', role: { key: { in: roleKeys } } },
      select: { userId: true, warehouseScope: true },
    });
    return members
      .filter((m) => m.warehouseScope.length === 0 || (warehouseId != null && m.warehouseScope.includes(warehouseId)))
      .map((m) => m.userId);
  }

  private async isActive(organizationId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.membership.findFirst({ where: { organizationId, userId, status: 'ACTIVE' }, select: { id: true } });
    return m !== null;
  }
}
