import { Module } from '@nestjs/common';
import { InventoryPolicyModule } from '../inventory-policy/inventory-policy.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [InventoryPolicyModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
