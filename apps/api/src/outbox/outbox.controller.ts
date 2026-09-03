import { Controller, Get } from '@nestjs/common';
import { OutboxHealthResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { OutboxRelayService } from './outbox-relay.service';

@Controller('outbox')
export class OutboxController {
  constructor(private readonly relay: OutboxRelayService) {}

  // Ops/observability surface — queue health, separate from any /health/ready gate (ADR 0010 §metrics).
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('health')
  health(@CurrentUser() user: RequestUser): Promise<OutboxHealthResponse> {
    return this.relay.health(user.organizationId);
  }
}
