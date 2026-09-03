import { Module } from '@nestjs/common';
import { ShelfLifeController } from './shelf-life.controller';
import { ShelfLifeService } from './shelf-life.service';

@Module({
  controllers: [ShelfLifeController],
  providers: [ShelfLifeService],
  exports: [ShelfLifeService],
})
export class ShelfLifeModule {}
