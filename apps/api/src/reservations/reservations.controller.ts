import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ReservationResponse, ReservationStatus, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/reservation.dto';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @RequirePermissions(PERMISSIONS.RESERVATION_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query('status') status?: ReservationStatus): Promise<ReservationResponse[]> {
    return this.reservations.list(user.organizationId, user, status);
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
