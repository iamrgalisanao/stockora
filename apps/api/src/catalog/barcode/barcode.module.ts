import { Module } from '@nestjs/common';
import { BarcodeController } from './barcode.controller';
import { BarcodeService } from './barcode.service';
import { BarcodeResolverService } from './barcode-resolver.service';

@Module({
  controllers: [BarcodeController],
  providers: [BarcodeService, BarcodeResolverService],
  exports: [BarcodeService, BarcodeResolverService],
})
export class BarcodeModule {}
