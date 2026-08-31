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
import { PERMISSIONS, UnitConversionResponse, UnitResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { UnitsService } from './units.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';
import { CreateUnitConversionDto } from './dto/conversion.dto';

@Controller()
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('units')
  list(@CurrentUser() user: RequestUser): Promise<UnitResponse[]> {
    return this.units.list(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post('units')
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateUnitDto): Promise<UnitResponse> {
    return this.units.create(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch('units/:id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ): Promise<UnitResponse> {
    return this.units.update(user.organizationId, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('unit-conversions')
  listConversions(@CurrentUser() user: RequestUser): Promise<UnitConversionResponse[]> {
    return this.units.listConversions(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post('unit-conversions')
  createConversion(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateUnitConversionDto,
  ): Promise<UnitConversionResponse> {
    return this.units.createConversion(user.organizationId, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Delete('unit-conversions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteConversion(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.units.deleteConversion(user.organizationId, id);
  }
}
