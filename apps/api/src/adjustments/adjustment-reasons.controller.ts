import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AdjustmentReasonResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AdjustmentReasonsService } from './adjustment-reasons.service';
import { CreateAdjustmentReasonDto, UpdateAdjustmentReasonDto } from './dto/reason.dto';

@Controller('adjustment-reasons')
export class AdjustmentReasonsController {
  constructor(private readonly reasons: AdjustmentReasonsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<AdjustmentReasonResponse[]> {
    return this.reasons.list(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAdjustmentReasonDto,
  ): Promise<AdjustmentReasonResponse> {
    return this.reasons.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdjustmentReasonDto,
  ): Promise<AdjustmentReasonResponse> {
    return this.reasons.update(user.organizationId, id, dto);
  }
}
