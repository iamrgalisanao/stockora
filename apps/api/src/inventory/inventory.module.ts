import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryQueryService } from './inventory-query.service';
import { LotsController } from '../lots/lots.controller';
import { LotsService } from '../lots/lots.service';

@Module({
  // Lots are inventory-domain (ADR 0007) and the backfill needs the posting engine, so they are
  // co-located here to keep a single acyclic module. Other domains import InventoryModule for LotsService.
  controllers: [InventoryController, LotsController],
  providers: [InventoryPostingService, InventoryQueryService, LotsService],
  exports: [InventoryPostingService, InventoryQueryService, LotsService],
})
export class InventoryModule {}
