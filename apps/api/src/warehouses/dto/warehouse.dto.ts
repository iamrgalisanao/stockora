import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { LOCATION_USAGES, LocationUsage, WAREHOUSE_TYPES, WarehouseType } from '@iw/contracts';

export class CreateWarehouseDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'code may contain letters, numbers, dot, dash, underscore' })
  @MaxLength(32)
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional() @IsIn(WAREHOUSE_TYPES) type?: WarehouseType;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() allowReceiving?: boolean;
  @IsOptional() @IsBoolean() allowDispatch?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateWarehouseDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsIn(WAREHOUSE_TYPES) type?: WarehouseType;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() allowReceiving?: boolean;
  @IsOptional() @IsBoolean() allowDispatch?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateLocationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(48)
  code!: string;

  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(24) type?: string;
  @IsOptional() @IsIn(LOCATION_USAGES) usage?: LocationUsage;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsBoolean() isPickable?: boolean;
}

export class UpdateLocationDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(24) type?: string;
  @IsOptional() @IsIn(LOCATION_USAGES) usage?: LocationUsage;
  @IsOptional() @IsBoolean() isPickable?: boolean;
}

/** Reparent a location within the SAME warehouse (null = make it a root). */
export class MoveLocationDto {
  @ValidateIf((o) => o.parentId !== null)
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
