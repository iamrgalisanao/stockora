import { Controller, Get } from '@nestjs/common';
import { DashboardSummary, PERMISSIONS, ReorderAssessment } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReorderAssessmentService } from '../inventory-policy/reorder-assessment.service';
import { DashboardService } from './dashboard.service';

@Controller()
export class AnalyticsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reorder: ReorderAssessmentService,
  ) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('dashboard/summary')
  summary(@CurrentUser() user: RequestUser): Promise<DashboardSummary> {
    return this.dashboard.summary(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('reorder/recommendations')
  reorderRecommendations(@CurrentUser() user: RequestUser): Promise<ReorderAssessment[]> {
    return this.reorder.recommendations(user.organizationId, user);
  }
}
