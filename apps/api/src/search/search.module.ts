import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { GlobalSearchService } from './global-search.service';
import { CatalogSearchProvider } from './providers/catalog-search.provider';
import { SupplierSearchProvider } from './providers/supplier-search.provider';
import { WarehouseSearchProvider } from './providers/warehouse-search.provider';
import { DocumentSearchProvider } from './providers/document-search.provider';

@Module({
  controllers: [SearchController],
  providers: [
    GlobalSearchService,
    CatalogSearchProvider,
    SupplierSearchProvider,
    WarehouseSearchProvider,
    DocumentSearchProvider,
  ],
  exports: [GlobalSearchService],
})
export class SearchModule {}
