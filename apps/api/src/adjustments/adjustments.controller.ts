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
import { AdjustmentListItem, AdjustmentResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AdjustmentsService } from './adjustments.service';
import { CreateAdjustmentDto, RejectAdjustmentDto, UpdateAdjustmentDto } from './dto/adjustment.dto';

@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<AdjustmentListItem[]> {
    return this.adjustments.list(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<AdjustmentResponse> {
    return this.adjustments.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAdjustmentDto): Promise<AdjustmentResponse> {
    return this.adjustments.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdjustmentDto,
  ): Promise<AdjustmentResponse> {
    return this.adjustments.update(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post(':id/submit')
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<AdjustmentResponse> {
    return this.adjustments.submit(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/approve')
  approve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<AdjustmentResponse> {
    return this.adjustments.approve(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/second-approve')
  secondApprove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<AdjustmentResponse> {
    return this.adjustments.secondApprove(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAdjustmentDto,
  ): Promise<AdjustmentResponse> {
    return this.adjustments.reject(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post(':id/post')
  post(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdjustmentResponse> {
    return this.adjustments.post(user.organizationId, user, id, idempotencyKey);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<AdjustmentResponse> {
    return this.adjustments.cancel(user.organizationId, user, id);
  }
}
