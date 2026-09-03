import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { NotificationRuleEngine } from './notification-rules.service';
import { NotificationConsumer } from './notification.consumer';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

/** Notifications (Phase 2D.2, ADR 0011): the outbox consumer + rule engine that build in-app notifications,
 *  and the personal inbox API. External channels arrive in 2D.2B. */
@Module({
  imports: [OutboxModule],
  controllers: [NotificationsController],
  providers: [NotificationRuleEngine, NotificationConsumer, NotificationsService],
})
export class NotificationsModule {}
