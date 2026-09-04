import { Module } from '@nestjs/common';
import { SerialsModule } from '../serials/serials.module';
import { MobileController } from './mobile.controller';
import { MobileWorkService } from './mobile-work.service';
import { MobileCommandService } from './mobile-command.service';

/**
 * Mobile Scanner PWA backend (Phase 2D.6, ADR 0014). Worklist read models + advisory claims + exactly-once
 * command intake. PrismaService is global; SerialsService (from SerialsModule) supplies capture policy and
 * in-stock serial sets for tracking requirements and cached eligibility.
 */
@Module({
  imports: [SerialsModule],
  controllers: [MobileController],
  providers: [MobileWorkService, MobileCommandService],
})
export class MobileModule {}
