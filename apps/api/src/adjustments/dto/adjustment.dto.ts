import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AdjustmentDirection } from '@iw/contracts';

const qty = { maxDecimalPlaces: 4 } as const;

export class AdjustmentItemInputDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsIn(['IN', 'OUT']) direction!: AdjustmentDirection;
  @IsNumber(qty) @IsPositive() quantity!: number;
  @IsOptional() @IsNumber(qty) @Min(0) unitCost?: number;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() lotId?: string; // required for batch-tracked products (ADR 0007)
  /**
   * Serialized products (2D.3B, ADR 0012). OUT: the exact existing IN_STOCK serials to remove; IN: the new
   * serials to register. Never an anonymous ±N for a serialized product.
   */
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(120, { each: true }) serialNumbers?: string[];
  /** For a serialized OUT line: whether the removed units become DISPOSED (default) or DAMAGED. */
  @IsOptional() @IsIn(['DISPOSED', 'DAMAGED']) serialDisposition?: 'DISPOSED' | 'DAMAGED';
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class CreateAdjustmentDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsUUID() reasonId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemInputDto)
  items!: AdjustmentItemInputDto[];
}

export class UpdateAdjustmentDto {
  @IsOptional() @IsUUID() reasonId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemInputDto)
  items?: AdjustmentItemInputDto[];
}

export class RejectAdjustmentDto {
  @IsString() @MaxLength(500) reason!: string;
}
