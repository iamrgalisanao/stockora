import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '@iw/contracts';

export class UpsertPreferenceDto {
  @IsString() @MaxLength(64) notificationType!: string;
  @IsIn(NOTIFICATION_CHANNELS) channel!: NotificationChannel;
  @IsBoolean() enabled!: boolean;
}
