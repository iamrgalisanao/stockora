import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PERMISSIONS, TransferListItem, TransferResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { TransfersService } from './transfers.service';
import { CreateTransferDto, DispatchTransferDto, RejectTransferDto, UpdateTransferDto } from './dto/transfer.dto';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<TransferListItem[]> {
    return this.transfers.list(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransferResponse> {
    return this.transfers.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransferDto): Promise<TransferResponse> {
    return this.transfers.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransferDto,
  ): Promise<TransferResponse> {
    return this.transfers.update(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Post(':id/submit')
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransferResponse> {
    return this.transfers.submit(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/approve')
  approve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransferResponse> {
    return this.transfers.approve(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTransferDto,
  ): Promise<TransferResponse> {
    return this.transfers.reject(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Post(':id/dispatch')
  dispatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispatchTransferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TransferResponse> {
    return this.transfers.dispatch(user.organizationId, user, id, idempotencyKey, dto?.serials);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Post(':id/receive')
  receive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TransferResponse> {
    return this.transfers.receive(user.organizationId, user, id, idempotencyKey);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<TransferResponse> {
    return this.transfers.cancel(user.organizationId, user, id);
  }
}
