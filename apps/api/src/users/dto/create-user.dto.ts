import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { CreateUserRequest } from '@iw/contracts';

export class CreateUserDto implements CreateUserRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  roleKey!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  warehouseScope?: string[];

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
