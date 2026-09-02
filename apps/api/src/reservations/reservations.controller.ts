import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ReservationResponse, ReservationStatus, ReservedBreakdownRow, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/reservation.dto';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: ReservationStatus,
    @Query('warehouseId') warehouseId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('q') q?: string,
    @Query('expiringSoon') expiringSoon?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ReservationResponse[]> {
    return this.reservations.list(user.organizationId, user, {
      status, warehouseId, sourceType, q, from, to, expiringSoon: expiringSoon === 'true',
    });
  }

  // Literal routes before `:id` so they aren't swallowed by the param route.
  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get('reserved-breakdown')
  reservedBreakdown(
    @CurrentUser() user: RequestUser,
    @Query('productId', ParseUUIDPipe) productId: string,
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('variantId') variantId?: string,
  ): Promise<ReservedBreakdownRow[]> {
    return this.reservations.reservedBreakdown(user.organizationId, user, productId, warehouseId, variantId);
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CANCEL)
  @Post('expire-due')
  expireDue(@CurrentUser() user: RequestUser): Promise<{ expired: number }> {
    return this.reservations.expireDue(user.organizationId, user.userId);
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationResponse> {
    return this.reservations.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CREATE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReservationDto): Promise<ReservationResponse> {
    return this.reservations.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CONFIRM)
  @Post(':id/confirm')
  confirm(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationResponse> {
    return this.reservations.confirm(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_RELEASE)
  @Post(':id/release')
  release(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationResponse> {
    return this.reservations.release(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.RESERVATION_CANCEL)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReservationResponse> {
    return this.reservations.cancel(user.organizationId, user, id);
  }
}
