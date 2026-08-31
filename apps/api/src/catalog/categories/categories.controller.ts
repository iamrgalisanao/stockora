import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CategoryResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<CategoryResponse[]> {
    return this.categories.list(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    return this.categories.update(user.organizationId, id, dto);
  }
}
