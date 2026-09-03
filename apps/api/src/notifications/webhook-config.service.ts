import { Injectable } from '@nestjs/common';
import type { OrganizationWebhookConfigResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';

/** Org-level webhook integration config + per-type subscriptions (ADR 0011, 2D.2C). The signing secret is
 *  never returned to clients — only whether one is set. */
@Injectable()
export class WebhookConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<OrganizationWebhookConfigResponse> {
    const config = await this.prisma.organizationWebhookConfig.findUnique({ where: { organizationId } });
    const subs = await this.prisma.webhookSubscription.findMany({ where: { organizationId }, orderBy: { notificationType: 'asc' } });
    return {
      url: config?.url ?? null,
      enabled: config?.enabled ?? false,
      hasSigningSecret: !!config?.signingSecret,
      subscriptions: subs.map((s) => ({ notificationType: s.notificationType, enabled: s.enabled })),
    };
  }

  async upsertConfig(organizationId: string, dto: { url: string; enabled: boolean; signingSecret?: string | null }): Promise<OrganizationWebhookConfigResponse> {
    // signingSecret: undefined = leave unchanged; '' = clear; value = set.
    const secretPatch = dto.signingSecret === undefined ? {} : { signingSecret: dto.signingSecret === '' ? null : dto.signingSecret };
    await this.prisma.organizationWebhookConfig.upsert({
      where: { organizationId },
      create: { organizationId, url: dto.url, enabled: dto.enabled, signingSecret: dto.signingSecret ? dto.signingSecret : null },
      update: { url: dto.url, enabled: dto.enabled, ...secretPatch },
    });
    return this.get(organizationId);
  }

  async setSubscription(organizationId: string, notificationType: string, enabled: boolean): Promise<OrganizationWebhookConfigResponse> {
    await this.prisma.webhookSubscription.upsert({
      where: { organizationId_notificationType: { organizationId, notificationType } },
      create: { organizationId, notificationType, enabled },
      update: { enabled },
    });
    return this.get(organizationId);
  }

  /** The enabled config to send with (url + secret), or null when webhook delivery is off for the org. */
  async activeConfig(organizationId: string): Promise<{ url: string; signingSecret: string | null } | null> {
    const config = await this.prisma.organizationWebhookConfig.findUnique({ where: { organizationId } });
    return config?.enabled ? { url: config.url, signingSecret: config.signingSecret } : null;
  }

  /** True when the org has an enabled webhook config AND an enabled subscription for the type. */
  async isSubscribed(organizationId: string, notificationType: string): Promise<boolean> {
    const config = await this.prisma.organizationWebhookConfig.findUnique({ where: { organizationId }, select: { enabled: true } });
    if (!config?.enabled) return false;
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { organizationId_notificationType: { organizationId, notificationType } },
      select: { enabled: true },
    });
    return sub?.enabled === true;
  }
}
