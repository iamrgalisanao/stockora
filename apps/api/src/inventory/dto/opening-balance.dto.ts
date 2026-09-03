import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OpeningBalanceLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() quantity!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitCost?: number;
  @IsOptional() @IsUUID() locationId?: string;
  // Lot fields (ADR 0007) — required for batch-tracked products, rejected otherwise.
  @IsOptional() @IsString() @MaxLength(60) lotNumber?: string;
  @IsOptional() @IsDateString() manufacturedAt?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  // Accept a lot below the product's minimum shelf life (ADR 0008) — requires inventory.expiry_override.
  @IsOptional() @IsBoolean() allowShortShelfLife?: boolean;
}

export class OpeningBalanceDto {
  @IsUUID() warehouseId!: string;

  @IsOptional() @IsString() @MaxLength(500) reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines!: OpeningBalanceLineDto[];
}

export class ReverseMovementDto {
  @IsString() @MaxLength(500) reason!: string;
}
