import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';
import type { LoginRequest } from '@iw/contracts';

export class LoginDto implements LoginRequest {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
