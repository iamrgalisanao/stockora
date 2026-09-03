import { Body, Controller, Get, Put } from '@nestjs/common';
import { OrganizationWebhookConfigResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { WebhookConfigService } from './webhook-config.service';
import { SetWebhookSubscriptionDto, UpsertWebhookConfigDto } from './dto/webhook.dto';

/** Org webhook integration admin (2D.2C). settings.manage; the signing secret is write-only. */
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
@Controller('notification-webhook')
export class WebhookConfigController {
  constructor(private readonly webhook: WebhookConfigService) {}

  @Get()
  get(@CurrentUser() user: RequestUser): Promise<OrganizationWebhookConfigResponse> {
    return this.webhook.get(user.organizationId);
  }

  @Put()
  upsert(@CurrentUser() user: RequestUser, @Body() dto: UpsertWebhookConfigDto): Promise<OrganizationWebhookConfigResponse> {
    return this.webhook.upsertConfig(user.organizationId, dto);
  }

  @Put('subscriptions')
  setSubscription(@CurrentUser() user: RequestUser, @Body() dto: SetWebhookSubscriptionDto): Promise<OrganizationWebhookConfigResponse> {
    return this.webhook.setSubscription(user.organizationId, dto.notificationType, dto.enabled);
  }
}
