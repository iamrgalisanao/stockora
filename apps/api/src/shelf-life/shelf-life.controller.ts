import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ShelfLifePolicyResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ShelfLifeService } from './shelf-life.service';
import { UpsertShelfLifePolicyDto } from './dto/shelf-life.dto';

@Controller('products/:productId/shelf-life-policy')
export class ShelfLifeController {
  constructor(private readonly service: ShelfLifeService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  get(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string): Promise<ShelfLifePolicyResponse> {
    return this.service.get(user.organizationId, productId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Put()
  upsert(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpsertShelfLifePolicyDto,
  ): Promise<ShelfLifePolicyResponse> {
    return this.service.upsert(user.organizationId, user, productId, dto);
  }
}
