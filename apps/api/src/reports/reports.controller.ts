import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  DeadStockRow,
  PERMISSIONS,
  REORDER_STATES,
  ReorderAssessment,
  ReorderState,
  VALUATION_GROUPINGS,
  ValuationGrouping,
  ValuationReport,
} from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions(PERMISSIONS.VALUATION_VIEW)
  @Get('valuation')
  valuation(
    @CurrentUser() user: RequestUser,
    @Query('groupBy') groupBy?: string,
  ): Promise<ValuationReport> {
    const g = (groupBy ?? 'warehouse') as ValuationGrouping;
    if (!VALUATION_GROUPINGS.includes(g)) {
      throw new BadRequestException(`groupBy must be one of ${VALUATION_GROUPINGS.join(', ')}`);
    }
    return this.reports.valuation(user.organizationId, user, g);
  }

  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('stock-status')
  stockStatus(
    @CurrentUser() user: RequestUser,
    @Query('state') state?: string,
  ): Promise<ReorderAssessment[]> {
    let filter: ReorderState | undefined;
    if (state) {
      if (!REORDER_STATES.includes(state as ReorderState)) {
        throw new BadRequestException(`state must be one of ${REORDER_STATES.join(', ')}`);
      }
      filter = state as ReorderState;
    }
    return this.reports.stockStatus(user.organizationId, user, filter);
  }

  @RequirePermissions(PERMISSIONS.REPORT_VIEW)
  @Get('dead-stock')
  deadStock(
    @CurrentUser() user: RequestUser,
    @Query('days') days?: string,
  ): Promise<DeadStockRow[]> {
    const n = days ? Number(days) : 90;
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException('days must be a non-negative number');
    return this.reports.deadStock(user.organizationId, user, n);
  }
}
