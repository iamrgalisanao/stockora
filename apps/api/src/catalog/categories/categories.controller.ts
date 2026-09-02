import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CategoryResponse, EntityStatus, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { ChangeStatusDto } from '../../common/dto/change-status.dto';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('q') q?: string,
    @Query('status') status?: EntityStatus,
  ): Promise<CategoryResponse[]> {
    return this.categories.list(user.organizationId, { q, status });
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCategoryDto): Promise<CategoryResponse> {
    return this.categories.create(user.organizationId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.update(user.organizationId, id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<CategoryResponse> {
    return this.categories.changeStatus(user.organizationId, id, dto.status, user);
  }
}
