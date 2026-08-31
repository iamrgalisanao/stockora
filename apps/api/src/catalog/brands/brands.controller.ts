import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { BrandResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<BrandResponse[]> {
    return this.brands.list(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBrandDto): Promise<BrandResponse> {
    return this.brands.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ): Promise<BrandResponse> {
    return this.brands.update(user.organizationId, id, dto);
  }
}
