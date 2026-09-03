import { Module } from '@nestjs/common';
import { SerialsController } from './serials.controller';
import { SerialsService } from './serials.service';

/**
 * Serial tracking (Phase 2D.3, ADR 0012). PrismaService and AuditService are global; capture rides the
 * receiving flow, so ReceivingModule imports this for SerialsService.
 */
@Module({
  controllers: [SerialsController],
  providers: [SerialsService],
  exports: [SerialsService],
})
export class SerialsModule {}
