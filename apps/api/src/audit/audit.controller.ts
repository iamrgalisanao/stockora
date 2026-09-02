import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AuditEntryResponse, AuditPage, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get()
  search(
    @CurrentUser() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditPage> {
    return this.audit.search(user, {
      from,
      to,
      actorId,
      action,
      entityType,
      entityId,
      warehouseId,
      q,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('correlation/:correlationId')
  correlation(
    @CurrentUser() user: RequestUser,
    @Param('correlationId', ParseUUIDPipe) correlationId: string,
  ): Promise<AuditEntryResponse[]> {
    return this.audit.correlation(user, correlationId);
  }
}
