import { Module } from '@nestjs/common';
import { InventoryPolicyModule } from '../inventory-policy/inventory-policy.module';
import { AnalyticsController } from './analytics.controller';
import { DashboardService } from './dashboard.service';
import { SupplierPerformanceService } from './supplier-performance.service';

@Module({
  imports: [InventoryPolicyModule],
  controllers: [AnalyticsController],
  providers: [DashboardService, SupplierPerformanceService],
  exports: [DashboardService, SupplierPerformanceService],
})
export class AnalyticsModule {}
