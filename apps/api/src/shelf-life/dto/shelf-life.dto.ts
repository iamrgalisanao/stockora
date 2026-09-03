import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ALLOCATION_STRATEGIES, type AllocationStrategy } from '@iw/contracts';

export class UpsertShelfLifePolicyDto {
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsBoolean() expiryTrackingRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) minimumShelfLifeOnReceiptDays?: number | null;
  @IsOptional() @IsInt() @Min(0) expiringSoonDays?: number | null;
  @IsOptional() @IsIn(ALLOCATION_STRATEGIES) allocationStrategy?: AllocationStrategy;
}
