import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { NotificationDeliveryService } from './notification-delivery.service';

/** Thin poller that drives dispatchPending() (ADR 0011 §8). Disabled under any test runner. */
@Injectable()
export class NotificationDeliveryPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NotifDeliveryPoller');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly delivery: NotificationDeliveryService) {}

  onApplicationBootstrap(): void {
    if (process.env.NOTIF_DELIVERY_POLLER === 'off' || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
      this.logger.log('notification delivery poller disabled');
      return;
    }
    const interval = Number(process.env.NOTIF_DELIVERY_POLL_INTERVAL_MS ?? 3000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref?.();
    this.logger.log(`notification delivery poller started (every ${interval}ms)`);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.delivery.dispatchPending(); }
    catch (err) { this.logger.error(`dispatchPending failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { this.running = false; }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
