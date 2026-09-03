import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { OperationalFactConsumer } from './operational-fact.consumer';

/** Internal outbox consumers that project delivered domain facts into read models (2D.1C). */
@Module({
  imports: [OutboxModule],
  providers: [OperationalFactConsumer],
})
export class ProjectionsModule {}
