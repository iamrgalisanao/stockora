import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { OutboxEventListItem, OutboxHealthResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { OutboxRelayService } from './outbox-relay.service';

@Controller('outbox')
export class OutboxController {
  constructor(private readonly relay: OutboxRelayService) {}

  // Ops/observability — queue health, separate from any /health/ready gate (ADR 0010 §metrics).
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('health')
  health(@CurrentUser() user: RequestUser): Promise<OutboxHealthResponse> {
    return this.relay.health(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('events')
  events(@CurrentUser() user: RequestUser, @Query('limit') limit?: string): Promise<OutboxEventListItem[]> {
    return this.relay.recentEvents(user.organizationId, limit ? Number(limit) : undefined);
  }

  // Manual dead-letter/failed retry — a mutating ops action, gated tighter than read-only health.
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Post(':id/retry')
  async retry(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.relay.retry(user.organizationId, id);
    return { ok: true };
  }
}
