import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ReturnResponse, ReturnStatus, ReturnType, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReturnsService } from './returns.service';
import { CreateReturnDto, CreateDispositionDto, ReceiveReturnDto } from './dto/return.dto';

@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @RequirePermissions(PERMISSIONS.RETURN_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: ReturnStatus,
    @Query('type') type?: ReturnType,
    @Query('warehouseId') warehouseId?: string,
    @Query('q') q?: string,
  ): Promise<ReturnResponse[]> {
    return this.returns.list(user.organizationId, user, { status, type, warehouseId, q });
  }

  @RequirePermissions(PERMISSIONS.RETURN_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReturnResponse> {
    return this.returns.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.RETURN_CREATE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReturnDto): Promise<ReturnResponse> {
    return this.returns.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.RETURN_RECEIVE)
  @Post(':id/receive')
  receive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveReturnDto,
  ): Promise<ReturnResponse> {
    return this.returns.receive(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.RETURN_CREATE)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReturnResponse> {
    return this.returns.cancel(user.organizationId, user, id);
  }

  // Floor permission is return.inspect; the service additionally requires return.dispose for the
  // outbound/irreversible outcomes (RETURN_TO_SUPPLIER / DISPOSE).
  @RequirePermissions(PERMISSIONS.RETURN_INSPECT)
  @Post(':id/dispositions')
  dispose(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDispositionDto,
  ): Promise<ReturnResponse> {
    return this.returns.dispose(user.organizationId, user, id, dto);
  }
}
