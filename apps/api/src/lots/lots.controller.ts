import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AllocationPlan, ExpiryDashboardRow, ExpiryEventType, LotExpiryFactResponse, LotExpiryState, LotMovementRow, LotResponse, PickableLot, PERMISSIONS } from '@iw/contracts';
import { Prisma } from '@prisma/client';
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

  /** Expiry dashboard — per-(lot, warehouse) rows with derived state + days remaining (2C.2C). */
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('expiry-dashboard')
  expiryDashboard(
    @CurrentUser() user: RequestUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('q') q?: string,
    @Query('expiryState') expiryState?: LotExpiryState,
    @Query('hasStock') hasStock?: string,
    @Query('withinDays') withinDays?: string,
  ): Promise<ExpiryDashboardRow[]> {
    return this.lots.expiryDashboard(user.organizationId, user, {
      warehouseId, productId, q, expiryState, hasStock: hasStock === 'true',
      withinDays: withinDays !== undefined ? Number(withinDays) : undefined,
    });
  }

  /** Run idempotent expiry-condition detection, emitting facts (never notifications). */
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Post('expiry-scan')
  expiryScan(@CurrentUser() user: RequestUser): Promise<{ expired: number; expiringSoon: number }> {
    return this.lots.scanExpiryFacts(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('expiry-facts')
  expiryFacts(@CurrentUser() user: RequestUser, @Query('eventType') eventType?: ExpiryEventType): Promise<LotExpiryFactResponse[]> {
    return this.lots.listExpiryFacts(user.organizationId, user, { eventType });
  }

  /** Advisory FEFO allocation preview (ADR 0008 §7) — read-only; authoritative allocation happens at post. */
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('fefo-plan')
  fefoPlan(
    @CurrentUser() user: RequestUser,
    @Query('productId', ParseUUIDPipe) productId: string,
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('quantity') quantity: string,
    @Query('variantId') variantId?: string,
  ): Promise<AllocationPlan> {
    const qty = new Prisma.Decimal(quantity || '0');
    return this.lots.fefoPlan(user.organizationId, user, productId, variantId ?? '00000000-0000-0000-0000-000000000000', warehouseId, qty);
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
