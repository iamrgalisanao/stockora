import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const qty = { maxDecimalPlaces: 4 } as const;

export class TransferItemInputDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsNumber(qty) @IsPositive() quantity!: number;
  @IsOptional() @IsUUID() lotId?: string; // required for batch-tracked products; one lot per line (ADR 0007)
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class CreateTransferDto {
  @IsUUID() sourceWarehouseId!: string;
  @IsUUID() destWarehouseId!: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferItemInputDto)
  items!: TransferItemInputDto[];
}

export class UpdateTransferDto {
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferItemInputDto)
  items?: TransferItemInputDto[];
}

export class RejectTransferDto {
  @IsString() @MaxLength(500) reason!: string;
}
