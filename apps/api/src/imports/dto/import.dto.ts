import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportUploadDto {
  @IsOptional() @IsString() @MaxLength(200) fileName?: string;

  @IsString()
  content!: string; // raw CSV text
}
