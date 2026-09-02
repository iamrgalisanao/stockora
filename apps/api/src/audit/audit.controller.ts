import { Controller, Get, Query } from '@nestjs/common';
import { AuditEntryResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditEntryResponse[]> {
    return this.audit.list(user.organizationId, {
      entityType,
      entityId,
      action,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
