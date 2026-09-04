import { Module } from '@nestjs/common';
import { SerialsModule } from '../serials/serials.module';
import { ReceivingModule } from '../receiving/receiving.module';
import { ReleasesModule } from '../releases/releases.module';
import { TransfersModule } from '../transfers/transfers.module';
import { CountsModule } from '../counts/counts.module';
import { ReturnsModule } from '../returns/returns.module';
import { MobileController } from './mobile.controller';
import { MobileWorkService } from './mobile-work.service';
import { MobileCommandService } from './mobile-command.service';
import { MobileDiagnosticsService } from './mobile-diagnostics.service';

/**
 * Mobile Scanner PWA backend (Phase 2D.6, ADR 0014). Worklist read models + advisory claims (2D.6B) and the
 * sync + conflict engine (2D.6C). The command processor ADAPTS mobile payloads into the existing domain
 * services (imported here) — it never reimplements receiving/release/transfer/count/return logic, so mobile
 * and desktop can't diverge and mobile inherits their locking + invariants.
 */
@Module({
  imports: [SerialsModule, ReceivingModule, ReleasesModule, TransfersModule, CountsModule, ReturnsModule],
  controllers: [MobileController],
  providers: [MobileWorkService, MobileCommandService, MobileDiagnosticsService],
})
export class MobileModule {}
