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
    // Off explicitly, or under any test runner — a background timer must never mutate shared state during
    // e2e (JEST_WORKER_ID is set in every Jest worker; NODE_ENV=test is a belt-and-suspenders guard).
    if (process.env.OUTBOX_POLLER === 'off' || process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
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
