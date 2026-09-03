import { Body, Controller, Get, Put } from '@nestjs/common';
import type { NotificationPreferenceResponse } from '@iw/contracts';
import { CurrentUser } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { NotificationPreferencesService } from './notification-preferences.service';
import { UpsertPreferenceDto } from './dto/notification-preference.dto';

/** Personal outbound-channel preferences (auth-only). Strict opt-in. */
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<NotificationPreferenceResponse[]> {
    return this.preferences.list(user);
  }

  @Put()
  upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertPreferenceDto): Promise<NotificationPreferenceResponse> {
    return this.preferences.upsert(user, dto);
  }
}
