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
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DISPOSITION_TYPES, RETURN_TYPES, type DispositionType, type ReturnType } from '@iw/contracts';

const q = { maxDecimalPlaces: 4 } as const;

export class CreateReturnLineDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsNumber(q) @IsPositive() quantity!: number;
}

export class CreateReturnDto {
  @IsIn(RETURN_TYPES) type!: ReturnType;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(120) sourceReference?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnLineDto)
  lines!: CreateReturnLineDto[];
}

/** Per-line received-quantity override at receive time; a line omitted here defaults to its declared qty. */
export class ReceiveReturnLineDto {
  @IsUUID() lineId!: string;
  @IsNumber(q) @Min(0) receivedQuantity!: number;
}

export class ReceiveReturnDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveReturnLineDto)
  lines?: ReceiveReturnLineDto[];
}

/** One inspection decision against a received return line (2B.2B). */
export class CreateDispositionDto {
  @IsUUID() lineId!: string;
  @IsIn(DISPOSITION_TYPES) type!: DispositionType;
  @IsNumber(q) @IsPositive() quantity!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Optional client key — a replay with the same key is a no-op (does not post twice). */
  @IsOptional() @IsString() @MaxLength(120) idempotencyKey?: string;
}
