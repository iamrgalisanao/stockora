import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAdjustmentReasonDto {
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, { message: 'code may contain uppercase letters, numbers, and underscores' })
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional() @IsBoolean() requiresEvidence?: boolean;
}

export class UpdateAdjustmentReasonDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() requiresEvidence?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
