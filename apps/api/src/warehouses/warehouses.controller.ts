import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PERMISSIONS, WarehouseLocationResponse, WarehouseResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { WarehousesService } from './warehouses.service';
import {
  CreateLocationDto,
  CreateWarehouseDto,
  UpdateLocationDto,
  UpdateWarehouseDto,
} from './dto/warehouse.dto';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<WarehouseResponse[]> {
    return this.warehouses.list(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WarehouseResponse> {
    return this.warehouses.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateWarehouseDto,
  ): Promise<WarehouseResponse> {
    return this.warehouses.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ): Promise<WarehouseResponse> {
    return this.warehouses.update(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id/locations')
  listLocations(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WarehouseLocationResponse[]> {
    return this.warehouses.listLocations(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @Post(':id/locations')
  createLocation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLocationDto,
  ): Promise<WarehouseLocationResponse> {
    return this.warehouses.createLocation(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.WAREHOUSE_MANAGE)
  @Patch(':id/locations/:locationId')
  updateLocation(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<WarehouseLocationResponse> {
    return this.warehouses.updateLocation(user.organizationId, user, id, locationId, dto);
  }
}
