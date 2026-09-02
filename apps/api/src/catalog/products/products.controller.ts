import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { EntityStatus, PERMISSIONS, ProductResponse, VariantResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { ChangeStatusDto } from '../../common/dto/change-status.dto';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  CreateVariantDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser, @Query('status') status?: EntityStatus): Promise<ProductResponse[]> {
    return this.products.list(user.organizationId, user, status);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ProductResponse> {
    return this.products.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductDto): Promise<ProductResponse> {
    return this.products.create(user.organizationId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    return this.products.update(user.organizationId, id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<ProductResponse> {
    return this.products.changeStatus(user.organizationId, id, dto.status, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post(':id/variants')
  addVariant(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ): Promise<VariantResponse> {
    return this.products.addVariant(user.organizationId, id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch(':id/variants/:variantId')
  updateVariant(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<VariantResponse> {
    return this.products.updateVariant(user.organizationId, id, variantId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post(':id/variants/:variantId/status')
  changeVariantStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<VariantResponse> {
    return this.products.changeVariantStatus(user.organizationId, id, variantId, dto.status, user);
  }
}
