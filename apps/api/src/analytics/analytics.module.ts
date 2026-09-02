import { Module } from '@nestjs/common';
import { InventoryPolicyModule } from '../inventory-policy/inventory-policy.module';
import { AnalyticsController } from './analytics.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [InventoryPolicyModule],
  controllers: [AnalyticsController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class AnalyticsModule {}
