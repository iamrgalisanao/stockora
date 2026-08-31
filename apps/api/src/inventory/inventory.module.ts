import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryQueryService } from './inventory-query.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryPostingService, InventoryQueryService],
  exports: [InventoryPostingService, InventoryQueryService],
})
export class InventoryModule {}
