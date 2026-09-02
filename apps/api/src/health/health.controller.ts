import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators';
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
}
