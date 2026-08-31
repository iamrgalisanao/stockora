import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RegisterOrganizationRequest } from '@iw/contracts';

export class RegisterOrganizationDto implements RegisterOrganizationRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organizationName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'organizationSlug may contain only lowercase letters, numbers, and hyphens',
  })
  @MaxLength(60)
  organizationSlug?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  currency?: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  adminName!: string;

  @IsString()
  @MinLength(8, { message: 'adminPassword must be at least 8 characters' })
  @MaxLength(128)
  adminPassword!: string;
}
