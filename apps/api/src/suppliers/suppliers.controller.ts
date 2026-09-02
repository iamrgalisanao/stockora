import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { EntityStatus, PERMISSIONS, SupplierProductResponse, SupplierResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ChangeStatusDto } from '../common/dto/change-status.dto';
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierDto,
  CreateSupplierProductDto,
  UpdateSupplierDto,
  UpdateSupplierProductDto,
} from './dto/supplier.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('q') q?: string,
    @Query('status') status?: EntityStatus,
  ): Promise<SupplierResponse[]> {
    return this.suppliers.list(user.organizationId, { q, status });
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierResponse> {
    return this.suppliers.get(user.organizationId, id);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSupplierDto,
  ): Promise<SupplierResponse> {
    return this.suppliers.create(user.organizationId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    return this.suppliers.update(user.organizationId, id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Post(':id/status')
  changeStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<SupplierResponse> {
    return this.suppliers.changeStatus(user.organizationId, id, dto.status, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id/products')
  listProducts(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierProductResponse[]> {
    return this.suppliers.listProducts(user.organizationId, id, user);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Post(':id/products')
  addProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupplierProductDto,
  ): Promise<SupplierProductResponse> {
    return this.suppliers.addProduct(user.organizationId, id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Patch(':id/products/:supplierProductId')
  updateProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('supplierProductId', ParseUUIDPipe) supplierProductId: string,
    @Body() dto: UpdateSupplierProductDto,
  ): Promise<SupplierProductResponse> {
    return this.suppliers.updateProduct(user.organizationId, id, supplierProductId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Post(':id/products/:supplierProductId/status')
  changeProductStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('supplierProductId', ParseUUIDPipe) supplierProductId: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<SupplierProductResponse> {
    return this.suppliers.changeProductStatus(user.organizationId, id, supplierProductId, dto.status, user);
  }
}
