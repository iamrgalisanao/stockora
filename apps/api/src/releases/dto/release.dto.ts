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
import { RELEASE_DESTINATION_TYPES, type ReleaseDestinationType } from '@iw/contracts';

const qty = { maxDecimalPlaces: 4 } as const;

/** A lot allocation on a release line (ADR 0007) — for batch-tracked products, allocations sum to the line qty. */
export class ReleaseAllocationInputDto {
  @IsUUID() lotId!: string;
  @IsNumber(qty) @IsPositive() quantity!: number;
}

export class ReleaseItemInputDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsNumber(qty) @IsPositive() requestedQty!: number;
  @IsOptional() @IsUUID() locationId?: string;
  /** When set, posting this line consumes the referenced reservation line (2B.1B). */
  @IsOptional() @IsUUID() reservationLineId?: string;
  /** Lot allocations (batch-tracked products only); must sum to the released quantity. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReleaseAllocationInputDto)
  allocations?: ReleaseAllocationInputDto[];
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class CreateReleaseDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(200) purpose?: string;
  @IsIn(RELEASE_DESTINATION_TYPES) destinationType!: ReleaseDestinationType;
  @IsOptional() @IsString() @MaxLength(200) destinationRef?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReleaseItemInputDto)
  items!: ReleaseItemInputDto[];
}

export class UpdateReleaseDto {
  @IsOptional() @IsString() @MaxLength(200) purpose?: string;
  @IsOptional() @IsIn(RELEASE_DESTINATION_TYPES) destinationType?: ReleaseDestinationType;
  @IsOptional() @IsString() @MaxLength(200) destinationRef?: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReleaseItemInputDto)
  items?: ReleaseItemInputDto[];
}

export class ApproveReleaseItemDto {
  @IsUUID() itemId!: string;
  @IsNumber(qty) @Min(0) approvedQty!: number;
}

export class ApproveReleaseDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveReleaseItemDto)
  items?: ApproveReleaseItemDto[];
}

export class RejectReleaseDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class PostReleaseDto {
  /** Required when a batch line's lot selection deviates from FEFO under a FEFO policy (ADR 0008 §6). */
  @IsOptional() @IsString() @MaxLength(500) fefoOverrideReason?: string;
}
