import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * Thin in-process poller: a timer that invokes the relay's processBatch(). It owns no business semantics —
 * the database (FOR UPDATE SKIP LOCKED) is the coordination mechanism, so running multiple app instances is
 * safe. Disabled with OUTBOX_POLLER=off (tests drive processBatch() directly for determinism).
 */
@Injectable()
export class OutboxPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OutboxPoller');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly relay: OutboxRelayService) {}

  onApplicationBootstrap(): void {
    // Off explicitly, or under tests — background timers must never mutate shared state during e2e.
    if (process.env.OUTBOX_POLLER === 'off' || process.env.NODE_ENV === 'test') {
      this.logger.log('outbox poller disabled');
      return;
    }
    const interval = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000);
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref?.(); // never keep the process alive for the poller alone
    this.logger.log(`outbox poller started (every ${interval}ms)`);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never let ticks stack
    this.running = true;
    try {
      await this.relay.processBatch();
    } catch (err) {
      this.logger.error(`processBatch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
