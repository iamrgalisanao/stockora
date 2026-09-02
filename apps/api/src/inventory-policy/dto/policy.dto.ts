import { IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

const q = { maxDecimalPlaces: 4 } as const;

export class CreatePolicyDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsNumber(q) @Min(0) minStock?: number;
  @IsOptional() @IsNumber(q) @Min(0) maxStock?: number;
  @IsOptional() @IsNumber(q) @Min(0) reorderPoint?: number;
  @IsNumber(q) @IsPositive() reorderQuantity!: number;
  @IsOptional() @IsUUID() preferredSupplierId?: string;
}

export class UpdatePolicyDto {
  @IsOptional() @IsNumber(q) @Min(0) minStock?: number;
  @IsOptional() @IsNumber(q) @Min(0) maxStock?: number | null;
  @IsOptional() @IsNumber(q) @Min(0) reorderPoint?: number;
  @IsOptional() @IsNumber(q) @IsPositive() reorderQuantity?: number;
  @IsOptional() @IsUUID() preferredSupplierId?: string | null;
}
