import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PERMISSIONS, SupplierProductResponse, SupplierResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
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
  list(@CurrentUser() user: RequestUser): Promise<SupplierResponse[]> {
    return this.suppliers.list(user.organizationId);
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
    return this.suppliers.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.SUPPLIER_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierResponse> {
    return this.suppliers.update(user.organizationId, id, dto);
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
  @Delete(':id/products/:supplierProductId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('supplierProductId', ParseUUIDPipe) supplierProductId: string,
  ): Promise<void> {
    return this.suppliers.removeProduct(user.organizationId, id, supplierProductId);
  }
}
