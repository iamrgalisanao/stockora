import { IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { MobileCommandType } from '@iw/contracts';

/** Body for POST /mobile/work/:type/:id/claim — the device asking to hold an advisory lease (ADR 0014 §9). */
export class ClaimWorkDto {
  @IsString() @MaxLength(200) deviceId!: string;
  /** Requested lease length in seconds; the server clamps it. Optional. */
  @IsOptional() @IsInt() @Min(1) leaseSeconds?: number;
}

/**
 * Body for POST /mobile/commands — a captured command submitted from the device (2D.6B, ADR 0014 §3).
 * organizationId and userId are taken from the authenticated principal, never the client. The server enforces
 * exactly-once on (org, idempotencyKey); execution against inventory is 2D.6C.
 */
export class SubmitCommandDto {
  @IsString() @MaxLength(64) commandId!: string; // client UUID
  @IsString() @MaxLength(200) idempotencyKey!: string;
  @IsString() @MaxLength(200) deviceId!: string;
  @IsString() @MaxLength(64) warehouseId!: string;
  @IsString() @MaxLength(40) commandType!: MobileCommandType;
  @IsOptional() @IsString() @MaxLength(64) aggregateId?: string;
  @IsOptional() @IsInt() expectedVersion?: number;
  @IsOptional() @IsString() @MaxLength(64) dependsOnCommandId?: string;
  @IsInt() schemaVersion!: number;
  @IsString() @MaxLength(40) appVersion!: string;
  @IsObject() payload!: Record<string, unknown>;
  @IsString() @MaxLength(40) capturedAt!: string;
}
