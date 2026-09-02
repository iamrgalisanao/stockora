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
  ValidateNested,
} from 'class-validator';
import { RESERVATION_SOURCES, type ReservationSource } from '@iw/contracts';

const q = { maxDecimalPlaces: 4 } as const;

export class CreateReservationLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsNumber(q) @IsPositive() quantity!: number;
}

export class CreateReservationDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsIn(RESERVATION_SOURCES) sourceType?: ReservationSource;
  @IsOptional() @IsString() @MaxLength(120) sourceId?: string;
  @IsOptional() @IsString() expiresAt?: string; // ISO; expiry enforcement is 2B.1C
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReservationLineDto)
  lines!: CreateReservationLineDto[];
}
