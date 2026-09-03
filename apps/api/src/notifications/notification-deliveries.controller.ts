import { Controller, Get, Query } from '@nestjs/common';
import { NotificationDeliveryListItem, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';

/** Admin delivery diagnostics (2D.2B). Org-scoped; sanitized errors; no message bodies. */
@Controller('notification-deliveries')
export class NotificationDeliveriesController {
  constructor(private readonly delivery: NotificationDeliveryService) {}

  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query('limit') limit?: string): Promise<NotificationDeliveryListItem[]> {
    return this.delivery.recentDeliveries(user.organizationId, limit ? Number(limit) : undefined);
  }
}
