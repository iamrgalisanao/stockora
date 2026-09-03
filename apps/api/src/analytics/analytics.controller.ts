import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import {
  DashboardSummary, PERMISSIONS, ReorderAssessment,
  type EvidenceMetric,
  type PreferredSupplierComparisonResponse,
  type SupplierAnalyticsPolicyResponse,
  type SupplierEvidenceResponse,
  type SupplierPerformanceResponse,
  type SupplierScorecardResponse,
  type SupplierTrendSeriesResponse,
} from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReorderAssessmentService } from '../inventory-policy/reorder-assessment.service';
import { DashboardService } from './dashboard.service';
import { SupplierPerformanceService } from './supplier-performance.service';
import { SupplierWeightsDto } from './dto/supplier-weights.dto';

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

  /** Org supplier-scoring weights (2D.4B) — relative, renormalized at calculation time. */
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('analytics/suppliers/policy')
  getWeights(@CurrentUser() user: RequestUser): Promise<SupplierAnalyticsPolicyResponse> {
    return this.supplierPerformance.getWeights(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Put('analytics/suppliers/policy')
  setWeights(@CurrentUser() user: RequestUser, @Body() dto: SupplierWeightsDto): Promise<SupplierAnalyticsPolicyResponse> {
    return this.supplierPerformance.upsertWeights(user.organizationId, dto);
  }

  /** Advisory preferred-vs-observed comparison off the authoritative InventoryPolicy.preferredSupplierId. */
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('analytics/suppliers/preferred-comparison')
  preferredComparison(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<PreferredSupplierComparisonResponse> {
    return this.supplierPerformance.preferredComparison(user.organizationId, user, { from, to, productId, warehouseId });
  }

  /** Supplier scorecard: current period + trend vs the equal-length prior period + per-product breakdown. */
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('analytics/suppliers/:id/scorecard')
  scorecard(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<SupplierScorecardResponse> {
    return this.supplierPerformance.scorecard(user.organizationId, user, id, { from, to, productId, warehouseId });
  }

  /** Time-series trends for a supplier (2D.4C) — deterministic granularity, coverage-per-bucket. */
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('analytics/suppliers/:id/trends')
  trends(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<SupplierTrendSeriesResponse> {
    return this.supplierPerformance.trends(user.organizationId, user, id, { from, to, productId, warehouseId });
  }

  /** Metric drill-down: the exact records in a metric's numerator/denominator (2D.4C). Price needs cost.view. */
  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('analytics/suppliers/:id/evidence')
  evidence(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('metric') metric: EvidenceMetric,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<SupplierEvidenceResponse> {
    const canViewCost = user.permissions.includes(PERMISSIONS.COST_VIEW);
    return this.supplierPerformance.evidence(user.organizationId, user, id, metric, { from, to, productId, warehouseId }, canViewCost);
  }
}
