import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { LotResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { LotsService } from './lots.service';

@Controller('lots')
export class LotsController {
  constructor(private readonly lots: LotsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('productId') productId?: string,
    @Query('status') status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED',
    @Query('q') q?: string,
  ): Promise<LotResponse[]> {
    return this.lots.list(user.organizationId, user, { productId, status, q });
  }

  // Legacy-lot backfill (ADR 0007) — literal route before `:id`.
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post('backfill-legacy')
  backfillLegacy(@CurrentUser() user: RequestUser): Promise<{ migrated: number }> {
    return this.lots.backfillLegacy(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<LotResponse> {
    return this.lots.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post(':id/close')
  close(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<LotResponse> {
    return this.lots.close(user.organizationId, user, id);
  }
}
