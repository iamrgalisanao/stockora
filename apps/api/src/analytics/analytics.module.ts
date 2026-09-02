import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { DashboardService } from './dashboard.service';
import { ReorderService } from './reorder.service';

@Module({
  controllers: [AnalyticsController],
  providers: [DashboardService, ReorderService],
  exports: [DashboardService, ReorderService],
})
export class AnalyticsModule {}
