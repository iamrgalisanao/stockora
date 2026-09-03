import { Injectable } from '@nestjs/common';
import type { NotificationChannel, NotificationPreferenceResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

/** Outbound-channel preferences (ADR 0011 §9). Strict opt-in: absence of a row means disabled. */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser): Promise<NotificationPreferenceResponse[]> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId: user.userId }, orderBy: [{ notificationType: 'asc' }, { channel: 'asc' }] });
    return rows.map((r) => ({ notificationType: r.notificationType, channel: r.channel, enabled: r.enabled }));
  }

  async upsert(user: RequestUser, dto: { notificationType: string; channel: NotificationChannel; enabled: boolean }): Promise<NotificationPreferenceResponse> {
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId_notificationType_channel: { userId: user.userId, notificationType: dto.notificationType, channel: dto.channel } },
      create: { userId: user.userId, notificationType: dto.notificationType, channel: dto.channel, enabled: dto.enabled },
      update: { enabled: dto.enabled },
    });
    return { notificationType: row.notificationType, channel: row.channel, enabled: row.enabled };
  }

  /** Subset of userIds that have EXPLICITLY enabled `channel` for `notificationType` (used at queue time). */
  async enabledUserIds(userIds: string[], notificationType: string, channel: NotificationChannel): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, notificationType, channel, enabled: true },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  /** True only if the user has an explicit enabled row (re-checked at send time). */
  async isEnabled(userId: string, notificationType: string, channel: NotificationChannel): Promise<boolean> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId_notificationType_channel: { userId, notificationType, channel } },
      select: { enabled: true },
    });
    return row?.enabled === true;
  }
}
