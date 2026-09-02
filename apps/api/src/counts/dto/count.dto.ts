import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { COUNT_TYPES, type CountType } from '@iw/contracts';

export class CreateCountDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsIn(COUNT_TYPES) type?: CountType;
  @IsOptional() @IsBoolean() isBlind?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  // Optional scope; when omitted, all products with a balance in the warehouse are snapshotted.
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) productIds?: string[];
}

export class CountEntryDto {
  @IsUUID() itemId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) countedQty!: number;
}

export class EnterCountsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CountEntryDto)
  items!: CountEntryDto[];
}
