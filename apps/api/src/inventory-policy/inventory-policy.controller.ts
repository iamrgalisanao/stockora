import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InventoryPolicyResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ChangeStatusDto } from '../common/dto/change-status.dto';
import { InventoryPolicyService } from './inventory-policy.service';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';

@Controller()
export class InventoryPolicyController {
  constructor(private readonly policies: InventoryPolicyService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('products/:productId/policies')
  listForProduct(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<InventoryPolicyResponse[]> {
    return this.policies.listForProduct(user.organizationId, user, productId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post('products/:productId/policies')
  create(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreatePolicyDto,
  ): Promise<InventoryPolicyResponse> {
    return this.policies.create(user.organizationId, user, productId, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch('inventory-policies/:id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePolicyDto,
  ): Promise<InventoryPolicyResponse> {
    return this.policies.update(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post('inventory-policies/:id/status')
  changeStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<InventoryPolicyResponse> {
    return this.policies.changeStatus(user.organizationId, user, id, dto.status);
  }
}
