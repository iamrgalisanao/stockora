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
