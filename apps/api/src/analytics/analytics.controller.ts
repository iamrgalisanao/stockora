import { Controller, Get } from '@nestjs/common';
import { DashboardSummary, PERMISSIONS, ReorderRecommendation } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { DashboardService } from './dashboard.service';
import { ReorderService } from './reorder.service';

@Controller()
export class AnalyticsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reorder: ReorderService,
  ) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('dashboard/summary')
  summary(@CurrentUser() user: RequestUser): Promise<DashboardSummary> {
    return this.dashboard.summary(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('reorder/recommendations')
  reorderRecommendations(@CurrentUser() user: RequestUser): Promise<ReorderRecommendation[]> {
    return this.reorder.recommendations(user.organizationId, user);
  }
}
