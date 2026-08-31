import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const money = { maxDecimalPlaces: 4 } as const;

export class CreateProductDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'sku may contain letters, numbers, dot, dash, underscore' })
  @MaxLength(64)
  sku!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) productType?: string;

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;

  @IsUUID() baseUomId!: string;
  @IsOptional() @IsUUID() purchaseUomId?: string;
  @IsOptional() @IsUUID() salesUomId?: string;

  @IsOptional() @IsNumber(money) @Min(0) cost?: number;
  @IsOptional() @IsNumber(money) @Min(0) sellingPrice?: number;
  @IsOptional() @IsString() @MaxLength(60) taxCategory?: string;
  @IsOptional() @IsUUID() preferredSupplierId?: string;

  @IsOptional() @IsNumber(money) @Min(0) minStock?: number;
  @IsOptional() @IsNumber(money) @Min(0) maxStock?: number;
  @IsOptional() @IsNumber(money) @Min(0) reorderPoint?: number;
  @IsOptional() @IsNumber(money) @Min(0) reorderQty?: number;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;

  @IsOptional() @IsBoolean() trackInventory?: boolean;
  @IsOptional() @IsBoolean() allowNegative?: boolean;
  @IsOptional() @IsBoolean() isSerialized?: boolean;
  @IsOptional() @IsBoolean() isBatchTracked?: boolean;
  @IsOptional() @IsBoolean() isExpiryTracked?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(64)
  sku?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) productType?: string;

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsUUID() baseUomId?: string;
  @IsOptional() @IsUUID() purchaseUomId?: string;
  @IsOptional() @IsUUID() salesUomId?: string;

  @IsOptional() @IsNumber(money) @Min(0) cost?: number;
  @IsOptional() @IsNumber(money) @Min(0) sellingPrice?: number;
  @IsOptional() @IsString() @MaxLength(60) taxCategory?: string;
  @IsOptional() @IsUUID() preferredSupplierId?: string;

  @IsOptional() @IsNumber(money) @Min(0) minStock?: number;
  @IsOptional() @IsNumber(money) @Min(0) maxStock?: number;
  @IsOptional() @IsNumber(money) @Min(0) reorderPoint?: number;
  @IsOptional() @IsNumber(money) @Min(0) reorderQty?: number;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;

  @IsOptional() @IsBoolean() trackInventory?: boolean;
  @IsOptional() @IsBoolean() allowNegative?: boolean;
  @IsOptional() @IsBoolean() isSerialized?: boolean;
  @IsOptional() @IsBoolean() isBatchTracked?: boolean;
  @IsOptional() @IsBoolean() isExpiryTracked?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateVariantDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(64)
  sku!: string;

  @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsNumber(money) @Min(0) cost?: number;
  @IsOptional() @IsNumber(money) @Min(0) sellingPrice?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._-]+$/) @MaxLength(64) sku?: string;
  @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsNumber(money) @Min(0) cost?: number;
  @IsOptional() @IsNumber(money) @Min(0) sellingPrice?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
