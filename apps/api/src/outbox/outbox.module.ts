import { Module } from '@nestjs/common';
import { RequestContextModule } from '../common/request-context.module';
import { OutboxService } from './outbox.service';

/**
 * Transactional outbox (Phase 2D.1, ADR 0010). 2D.1A provides the enqueue seam only; the relay/dispatch
 * worker and domain integrations arrive in 2D.1B / 2D.1C.
 */
@Module({
  imports: [RequestContextModule],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
