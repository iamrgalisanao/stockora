import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ImportJobResponse, ImportPreviewResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ImportService } from './import.service';
import { ImportUploadDto } from './dto/import.dto';

@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @RequirePermissions(PERMISSIONS.IMPORT_PRODUCTS)
  @Post('products/preview')
  previewProducts(@CurrentUser() user: RequestUser, @Body() dto: ImportUploadDto): Promise<ImportPreviewResponse> {
    return this.imports.preview(user.organizationId, user, 'PRODUCTS', { fileName: dto.fileName ?? 'products.csv', content: dto.content });
  }

  @RequirePermissions(PERMISSIONS.IMPORT_SUPPLIERS)
  @Post('suppliers/preview')
  previewSuppliers(@CurrentUser() user: RequestUser, @Body() dto: ImportUploadDto): Promise<ImportPreviewResponse> {
    return this.imports.preview(user.organizationId, user, 'SUPPLIERS', { fileName: dto.fileName ?? 'suppliers.csv', content: dto.content });
  }

  @RequirePermissions(PERMISSIONS.IMPORT_OPENING_INVENTORY)
  @Post('opening-inventory/preview')
  previewOpeningInventory(@CurrentUser() user: RequestUser, @Body() dto: ImportUploadDto): Promise<ImportPreviewResponse> {
    return this.imports.preview(user.organizationId, user, 'OPENING_INVENTORY', { fileName: dto.fileName ?? 'opening-inventory.csv', content: dto.content });
  }

  // Authenticated; the import-type permission is enforced per job in the service.
  @Get(':jobId')
  get(@CurrentUser() user: RequestUser, @Param('jobId', ParseUUIDPipe) jobId: string): Promise<ImportPreviewResponse> {
    return this.imports.getJob(user.organizationId, user, jobId);
  }

  @Post(':jobId/commit')
  commit(@CurrentUser() user: RequestUser, @Param('jobId', ParseUUIDPipe) jobId: string): Promise<ImportJobResponse> {
    return this.imports.commit(user.organizationId, user, jobId);
  }
}
