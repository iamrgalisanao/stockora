-- Generalized delivery model + org webhook integration (Phase 2D.2C, ADR 0011).

-- Generalize NotificationDelivery: belongs to the Notification; recipient optional (null for WEBHOOK).
ALTER TABLE "notification_deliveries" ADD COLUMN "notification_id" UUID;
ALTER TABLE "notification_deliveries" ADD COLUMN "organization_id" UUID;
ALTER TABLE "notification_deliveries" ALTER COLUMN "notification_recipient_id" DROP NOT NULL;

-- Backfill existing (all EMAIL, recipient-scoped) rows.
UPDATE "notification_deliveries" d
SET "notification_id" = nr."notification_id",
    "organization_id" = n."organization_id"
FROM "notification_recipients" nr
JOIN "notifications" n ON n."id" = nr."notification_id"
WHERE d."notification_recipient_id" = nr."id";

ALTER TABLE "notification_deliveries" ALTER COLUMN "notification_id" SET NOT NULL;
ALTER TABLE "notification_deliveries" ALTER COLUMN "organization_id" SET NOT NULL;

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notification_deliveries_organization_id_created_at_idx" ON "notification_deliveries"("organization_id", "created_at");

-- Org webhook integration.
CREATE TABLE "organization_webhook_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "signing_secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_webhook_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_webhook_configs_organization_id_key" ON "organization_webhook_configs"("organization_id");

CREATE TABLE "webhook_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "notification_type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_subscriptions_organization_id_notification_type_key" ON "webhook_subscriptions"("organization_id", "notification_type");
