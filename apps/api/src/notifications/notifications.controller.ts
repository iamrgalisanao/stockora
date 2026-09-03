import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { NotificationResponse, UnreadCountResponse } from '@iw/contracts';
import { CurrentUser } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { NotificationsService } from './notifications.service';

/**
 * Personal in-app inbox. Auth-only (no @RequirePermissions): every member reads their own notifications.
 * Ownership is enforced by scoping every query to the caller's userId + organization.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ): Promise<NotificationResponse[]> {
    return this.notifications.list(user, { unread: unread === 'true', limit: limit ? Number(limit) : undefined });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestUser): Promise<UnreadCountResponse> {
    return { unread: await this.notifications.unreadCount(user) };
  }

  @Post('read-all')
  readAll(@CurrentUser() user: RequestUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  async read(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.notifications.markRead(user, id);
    return { ok: true };
  }

  @Post(':id/dismiss')
  async dismiss(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.notifications.dismiss(user, id);
    return { ok: true };
  }
}
