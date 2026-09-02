import { Module } from '@nestjs/common';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CountsController } from './counts.controller';
import { CountsService } from './counts.service';

@Module({
  imports: [WarehousesModule, InventoryModule],
  controllers: [CountsController],
  providers: [CountsService],
  exports: [CountsService],
})
export class CountsModule {}
