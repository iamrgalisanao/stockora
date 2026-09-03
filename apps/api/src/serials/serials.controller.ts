import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  type SerialHistoryResponse,
  type SerialReconciliationResult,
  type SerialResponse,
  type SerialStatus,
  type SerialTrackingPolicyResponse,
} from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { SerialsService } from './serials.service';
import { UpsertSerialPolicyDto } from './dto/serial-policy.dto';

@Controller('serials')
export class SerialsController {
  constructor(private readonly serials: SerialsService) {}

  @RequirePermissions(PERMISSIONS.SERIAL_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: SerialStatus,
    @Query('lotId') lotId?: string,
    @Query('serialNumber') serialNumber?: string,
    @Query('q') q?: string,
    @Query('inInventory') inInventory?: string,
  ): Promise<SerialResponse[]> {
    return this.serials.list(user.organizationId, user, { productId, warehouseId, status, lotId, serialNumber, q, inInventory: inInventory === 'true' });
  }

  // Literal routes before `:id`.
  @RequirePermissions(PERMISSIONS.SERIAL_VIEW)
  @Get('reconcile')
  reconcile(@CurrentUser() user: RequestUser, @Query('productId') productId?: string): Promise<SerialReconciliationResult> {
    return this.serials.reconcile(user.organizationId, { productId });
  }

  @RequirePermissions(PERMISSIONS.SERIAL_VIEW)
  @Get('policies/:productId')
  getPolicy(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<SerialTrackingPolicyResponse> {
    return this.serials.getPolicy(user.organizationId, productId);
  }

  @RequirePermissions(PERMISSIONS.SERIAL_MANAGE_POLICY)
  @Put('policies/:productId')
  upsertPolicy(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpsertSerialPolicyDto,
  ): Promise<SerialTrackingPolicyResponse> {
    return this.serials.upsertPolicy(user.organizationId, user, productId, dto);
  }

  @RequirePermissions(PERMISSIONS.SERIAL_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<SerialResponse> {
    return this.serials.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.SERIAL_VIEW)
  @Get(':id/history')
  history(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<SerialHistoryResponse> {
    return this.serials.history(user.organizationId, user, id);
  }
}
