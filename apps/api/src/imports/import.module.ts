import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ProductImportValidator } from './validators/product-import.validator';
import { SupplierImportValidator } from './validators/supplier-import.validator';
import { OpeningInventoryImportValidator } from './validators/opening-inventory-import.validator';

@Module({
  imports: [InventoryModule],
  controllers: [ImportController],
  providers: [ImportService, ProductImportValidator, SupplierImportValidator, OpeningInventoryImportValidator],
  exports: [ImportService],
})
export class ImportModule {}
