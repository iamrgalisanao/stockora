import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'code may contain letters, numbers, dot, dash, underscore' })
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(160)
  companyName!: string;

  @IsOptional() @IsString() @MaxLength(120) contactPerson?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) paymentTerms?: string;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsBoolean() isPreferred?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @IsOptional() @IsString() @MaxLength(120) contactPerson?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) paymentTerms?: string;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsBoolean() isPreferred?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateSupplierProductDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsString() @MaxLength(64) supplierSku?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) cost?: number;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) minOrderQty?: number;
  @IsOptional() @IsBoolean() isPreferred?: boolean;
}

export class UpdateSupplierProductDto {
  @IsOptional() @IsString() @MaxLength(64) supplierSku?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) cost?: number;
  @IsOptional() @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) minOrderQty?: number;
  @IsOptional() @IsBoolean() isPreferred?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
