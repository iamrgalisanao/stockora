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
import { PERMISSIONS, ReceiptListItem, ReceiptResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReceivingService } from './receiving.service';
import { CreateReceiptDto, UpdateReceiptDto } from './dto/receipt.dto';

@Controller('receiving')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ReceiptListItem[]> {
    return this.receiving.list(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReceiptResponse> {
    return this.receiving.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReceiptDto): Promise<ReceiptResponse> {
    return this.receiving.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReceiptDto,
  ): Promise<ReceiptResponse> {
    return this.receiving.update(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @Post(':id/post')
  postReceipt(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReceiptResponse> {
    return this.receiving.post(user.organizationId, user, id, idempotencyKey);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReceiptResponse> {
    return this.receiving.cancel(user.organizationId, user, id);
  }
}
