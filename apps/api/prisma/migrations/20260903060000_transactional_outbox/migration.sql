-- Transactional Outbox (Phase 2D.1A, ADR 0010).
-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlation_id" UUID,
    "causation_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_organization_id_aggregate_type_aggregate_id_idx" ON "outbox_events"("organization_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_events_organization_id_event_type_occurred_at_idx" ON "outbox_events"("organization_id", "event_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_organization_id_dedupe_key_key" ON "outbox_events"("organization_id", "dedupe_key");
