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
  Min,
  ValidateNested,
} from 'class-validator';

export class OpeningBalanceLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() quantity!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitCost?: number;
  @IsOptional() @IsUUID() locationId?: string;
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
