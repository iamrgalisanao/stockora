import { Controller, Get, Query } from '@nestjs/common';
import { DashboardSummary, PERMISSIONS, ReorderAssessment, type SupplierPerformanceResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReorderAssessmentService } from '../inventory-policy/reorder-assessment.service';
import { DashboardService } from './dashboard.service';
import { SupplierPerformanceService } from './supplier-performance.service';

@Controller()
export class AnalyticsController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly reorder: ReorderAssessmentService,
    private readonly supplierPerformance: SupplierPerformanceService,
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

  /** Supplier performance comparison over a period (2D.4A). Transparent, receipt-traceable metrics. */
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('analytics/suppliers')
  suppliers(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('supplierId') supplierId?: string,
  ): Promise<SupplierPerformanceResponse> {
    return this.supplierPerformance.compare(user.organizationId, user, { from, to, productId, warehouseId, supplierId });
  }
}
