import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { NotificationRuleEngine } from './notification-rules.service';
import { NotificationConsumer } from './notification.consumer';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationDeliveriesController } from './notification-deliveries.controller';
import { WebhookConfigService } from './webhook-config.service';
import { WebhookConfigController } from './webhook-config.controller';
import { ChannelAdapterRegistry } from './delivery/channel-adapter';
import { ConsoleEmailAdapter } from './delivery/console-email.adapter';
import { ConsoleWebhookAdapter } from './delivery/console-webhook.adapter';
import { NotificationTemplateRenderer } from './delivery/template-renderer';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';
import { NotificationDeliveryPoller } from './delivery/notification-delivery.poller';

/**
 * Notifications (Phase 2D.2, ADR 0011). 2D.2A: outbox consumer + rule engine + in-app inbox. 2D.2B: the
 * external delivery framework — strict-opt-in preferences, a pluggable channel adapter (console email),
 * a retrying/dead-lettering dispatcher + poller, and admin delivery diagnostics.
 */
@Module({
  imports: [OutboxModule],
  controllers: [NotificationsController, NotificationPreferencesController, NotificationDeliveriesController, WebhookConfigController],
  providers: [
    NotificationRuleEngine,
    NotificationConsumer,
    NotificationsService,
    NotificationPreferencesService,
    WebhookConfigService,
    ChannelAdapterRegistry,
    ConsoleEmailAdapter,
    ConsoleWebhookAdapter,
    NotificationTemplateRenderer,
    NotificationDeliveryService,
    NotificationDeliveryPoller,
  ],
  exports: [NotificationDeliveryService],
})
export class NotificationsModule {}
