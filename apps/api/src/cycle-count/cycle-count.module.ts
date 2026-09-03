import { Module } from '@nestjs/common';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { CountsModule } from '../counts/counts.module';
import { CycleCountController } from './cycle-count.controller';
import { CycleCountService } from './cycle-count.service';

@Module({
  imports: [WarehousesModule, CountsModule],
  controllers: [CycleCountController],
  providers: [CycleCountService],
  exports: [CycleCountService],
})
export class CycleCountModule {}
