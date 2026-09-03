import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/request-user';

/** Personal in-app inbox (ADR 0011 §8). Each endpoint acts on the caller's own recipient rows only. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser, opts: { unread?: boolean; limit?: number }): Promise<NotificationResponse[]> {
    const rows = await this.prisma.notificationRecipient.findMany({
      where: {
        userId: user.userId,
        dismissedAt: null,
        ...(opts.unread ? { readAt: null } : {}),
        notification: { organizationId: user.organizationId },
      },
      include: { notification: true },
      orderBy: { notification: { createdAt: 'desc' } },
      take: Math.min(opts.limit ?? 50, 200),
    });
    return rows.map((r) => ({
      id: r.notification.id,
      type: r.notification.type,
      title: r.notification.title,
      message: r.notification.message,
      severity: r.notification.severity,
      entityType: r.notification.entityType,
      entityId: r.notification.entityId,
      warehouseId: r.notification.warehouseId,
      createdAt: r.notification.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
      dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
    }));
  }

  async unreadCount(user: RequestUser): Promise<number> {
    return this.prisma.notificationRecipient.count({
      where: { userId: user.userId, readAt: null, dismissedAt: null, notification: { organizationId: user.organizationId } },
    });
  }

  /** Marks the caller's own recipient row read. Scoped by userId, so it never touches another user's row. */
  async markRead(user: RequestUser, notificationId: string): Promise<void> {
    const recipient = await this.own(user, notificationId);
    if (!recipient.readAt) {
      await this.prisma.notificationRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } });
    }
  }

  async markAllRead(user: RequestUser): Promise<{ updated: number }> {
    const res = await this.prisma.notificationRecipient.updateMany({
      where: { userId: user.userId, readAt: null, dismissedAt: null, notification: { organizationId: user.organizationId } },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  async dismiss(user: RequestUser, notificationId: string): Promise<void> {
    const recipient = await this.own(user, notificationId);
    if (!recipient.dismissedAt) {
      await this.prisma.notificationRecipient.update({ where: { id: recipient.id }, data: { dismissedAt: new Date() } });
    }
  }

  private async own(user: RequestUser, notificationId: string): Promise<{ id: string; readAt: Date | null; dismissedAt: Date | null }> {
    const recipient = await this.prisma.notificationRecipient.findFirst({
      where: { notificationId, userId: user.userId, notification: { organizationId: user.organizationId } },
      select: { id: true, readAt: true, dismissedAt: true },
    });
    if (!recipient) throw new NotFoundException('Notification not found');
    return recipient;
  }
}
