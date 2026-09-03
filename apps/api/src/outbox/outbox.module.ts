import { Module } from '@nestjs/common';
import { RequestContextModule } from '../common/request-context.module';
import { OutboxService } from './outbox.service';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxPoller } from './outbox-poller';
import { ConsumerRegistry } from './consumer-registry.service';
import { ConsumerReceipts } from './consumer-receipts.service';
import { OutboxController } from './outbox.controller';

/**
 * Transactional outbox (Phase 2D.1, ADR 0010). 2D.1A: the enqueue seam. 2D.1B: the DB-backed relay
 * (claim/lease with SKIP LOCKED, retry/backoff, dead-letter), the idempotent-consumer registry + receipts,
 * a thin poller, and a health surface. Domain integrations arrive in 2D.1C.
 */
@Module({
  imports: [RequestContextModule],
  controllers: [OutboxController],
  providers: [OutboxService, OutboxRelayService, OutboxPoller, ConsumerRegistry, ConsumerReceipts],
  exports: [OutboxService, OutboxRelayService, ConsumerRegistry, ConsumerReceipts],
})
export class OutboxModule {}
