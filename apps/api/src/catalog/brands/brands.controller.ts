import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { BrandResponse, EntityStatus, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { ChangeStatusDto } from '../../common/dto/change-status.dto';
import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('q') q?: string,
    @Query('status') status?: EntityStatus,
  ): Promise<BrandResponse[]> {
    return this.brands.list(user.organizationId, { q, status });
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBrandDto): Promise<BrandResponse> {
    return this.brands.create(user.organizationId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ): Promise<BrandResponse> {
    return this.brands.update(user.organizationId, id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<BrandResponse> {
    return this.brands.changeStatus(user.organizationId, id, dto.status, user);
  }
}
