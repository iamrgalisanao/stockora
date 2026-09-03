import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { LotExpiryState, LotMovementRow, LotResponse, PickableLot, PERMISSIONS } from '@iw/contracts';
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
    @Query('warehouseId') warehouseId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('hasStock') hasStock?: string,
    @Query('expiryState') expiryState?: LotExpiryState,
  ): Promise<LotResponse[]> {
    return this.lots.list(user.organizationId, user, { productId, status, q, warehouseId, supplierId, hasStock: hasStock === 'true', expiryState });
  }

  // Literal routes before `:id`.
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post('backfill-legacy')
  backfillLegacy(@CurrentUser() user: RequestUser): Promise<{ migrated: number }> {
    return this.lots.backfillLegacy(user.organizationId, user);
  }

  /** The shared operational lot picker feed: ACTIVE lots of a product with stock at a warehouse. */
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('pickable')
  pickable(
    @CurrentUser() user: RequestUser,
    @Query('productId', ParseUUIDPipe) productId: string,
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('variantId') variantId?: string,
  ): Promise<PickableLot[]> {
    return this.lots.pickable(user.organizationId, user, productId, warehouseId, variantId);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<LotResponse> {
    return this.lots.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id/movements')
  movements(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<LotMovementRow[]> {
    return this.lots.movements(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post(':id/close')
  close(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<LotResponse> {
    return this.lots.close(user.organizationId, user, id);
  }
}
