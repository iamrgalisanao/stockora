import { Module } from '@nestjs/common';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [WarehousesModule, InventoryModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
