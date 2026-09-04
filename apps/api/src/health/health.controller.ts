import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { MobileHealthResponse } from '@iw/contracts';
import { CurrentUser, Public } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { COMMAND_SCHEMA_VERSION, MIN_APP_VERSION, OFFLINE_AUTH_WINDOW_SECONDS } from '../common/mobile.constants';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — the process is up. Never touches the database (won't flap on DB blips). */
  @Public()
  @Get('live')
  live(): { status: string; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Readiness — the process can serve traffic (database reachable). 503 when it cannot. */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; db: string; time: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', db: 'down' });
    }
    return { status: 'ok', db: 'ok', time: new Date().toISOString() };
  }

  /** Back-compat combined check. */
  @Public()
  @Get()
  async check(): Promise<{ status: string; db: string; time: string }> {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, time: new Date().toISOString() };
  }

  /**
   * Mobile connectivity + session probe (2D.6A, ADR 0014 §5, §12). NOT public: reaching it with a 200 proves
   * both real API reachability AND that the caller's session is still valid. It echoes the scope the server
   * currently grants, so the client can detect a warehouse-scope or authorization change at reconnect and
   * revalidate queued work. Deliberately does not touch the database — this is a hot, per-tick probe.
   */
  @Get('mobile')
  mobile(@CurrentUser() user: RequestUser): MobileHealthResponse {
    return {
      status: 'ok',
      serverTime: new Date().toISOString(),
      userId: user.userId,
      organizationId: user.organizationId,
      warehouseScope: user.warehouseScope,
      minAppVersion: MIN_APP_VERSION,
      commandSchemaVersion: COMMAND_SCHEMA_VERSION,
      offlineAuthWindowSeconds: OFFLINE_AUTH_WINDOW_SECONDS,
    };
  }
}
