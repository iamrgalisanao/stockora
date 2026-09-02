import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { BARCODE_TYPES, ENTITY_STATUSES, type BarcodeType, type EntityStatus } from '@iw/contracts';

export class CreateBarcodeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'code may contain letters, numbers, dot, dash, underscore' })
  @MaxLength(64)
  code!: string;

  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsIn(BARCODE_TYPES) barcodeType?: BarcodeType;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpdateBarcodeDto {
  @IsOptional() @IsIn(BARCODE_TYPES) barcodeType?: BarcodeType;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsIn(ENTITY_STATUSES) status?: EntityStatus;
}
