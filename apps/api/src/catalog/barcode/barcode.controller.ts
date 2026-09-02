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
  Query,
} from '@nestjs/common';
import { BarcodeResolutionResult, BarcodeResponse, PERMISSIONS, ScanDiagnosis } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { BarcodeService } from './barcode.service';
import { BarcodeResolverService } from './barcode-resolver.service';
import { CreateBarcodeDto, UpdateBarcodeDto } from './dto/barcode.dto';

@Controller()
export class BarcodeController {
  constructor(
    private readonly barcodes: BarcodeService,
    private readonly resolver: BarcodeResolverService,
  ) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('resolve')
  resolve(@CurrentUser() user: RequestUser, @Query('code') code: string): Promise<BarcodeResolutionResult> {
    return this.resolver.resolve(user.organizationId, (code ?? '').trim());
  }

  // Privileged diagnostic — explains WHY a code no longer resolves (inactive/archived/etc.).
  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Get('resolve/diagnose')
  diagnose(@CurrentUser() user: RequestUser, @Query('code') code: string): Promise<ScanDiagnosis> {
    return this.resolver.diagnose(user.organizationId, (code ?? '').trim());
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('products/:productId/barcodes')
  list(@CurrentUser() user: RequestUser, @Param('productId', ParseUUIDPipe) productId: string): Promise<BarcodeResponse[]> {
    return this.barcodes.list(user.organizationId, productId);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Post('products/:productId/barcodes')
  assign(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateBarcodeDto,
  ): Promise<BarcodeResponse> {
    return this.barcodes.assign(user.organizationId, productId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Patch('products/:productId/barcodes/:barcodeId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
    @Body() dto: UpdateBarcodeDto,
  ): Promise<BarcodeResponse> {
    return this.barcodes.update(user.organizationId, productId, barcodeId, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  @Delete('products/:productId/barcodes/:barcodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('barcodeId', ParseUUIDPipe) barcodeId: string,
  ): Promise<void> {
    return this.barcodes.remove(user.organizationId, productId, barcodeId, user);
  }
}
