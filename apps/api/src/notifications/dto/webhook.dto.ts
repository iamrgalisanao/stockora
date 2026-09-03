import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { NOTIFICATION_TYPES, type NotificationType } from '@iw/contracts';

export class UpsertWebhookConfigDto {
  @IsUrl({ require_tld: false }) url!: string; // allow http://localhost for dev
  @IsBoolean() enabled!: boolean;
  // Omit to leave unchanged; empty string clears it.
  @IsOptional() @IsString() @MaxLength(256) signingSecret?: string;
}

export class SetWebhookSubscriptionDto {
  @IsIn(NOTIFICATION_TYPES) notificationType!: NotificationType;
  @IsBoolean() enabled!: boolean;
}
