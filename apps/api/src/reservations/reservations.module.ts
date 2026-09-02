import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

const EXPIRY_INTERVAL_MS = 60_000;

@Module({
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly reservations: ReservationsService) {}

  onModuleInit(): void {
    // A minimal recurring sweep (not a scheduler framework — ADR 0005). Off under test; later this can
    // move onto the domain-events/outbox infra. The endpoint POST /reservations/expire-due also exists.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.reservations.expireDue().catch(() => undefined);
    }, EXPIRY_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
