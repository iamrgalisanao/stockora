import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { UpdateUserRequest } from '@iw/contracts';

export class UpdateUserDto implements UpdateUserRequest {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  roleKey?: string;

  // Allow either null (= all warehouses) or an array of warehouse ids.
  @IsOptional()
  @ValidateIf((o: UpdateUserDto) => o.warehouseScope !== null)
  @IsArray()
  @IsUUID('all', { each: true })
  warehouseScope?: string[] | null;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}
