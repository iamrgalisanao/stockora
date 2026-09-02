import { Module } from '@nestjs/common';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentReasonsController } from './adjustment-reasons.controller';
import { AdjustmentReasonsService } from './adjustment-reasons.service';

@Module({
  imports: [WarehousesModule, InventoryModule],
  controllers: [AdjustmentsController, AdjustmentReasonsController],
  providers: [AdjustmentsService, AdjustmentReasonsService],
  exports: [AdjustmentsService, AdjustmentReasonsService],
})
export class AdjustmentsModule {}
