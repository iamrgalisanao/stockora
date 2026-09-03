-- Operational fact projection — first internal outbox consumer (Phase 2D.1C, ADR 0010).
-- CreateTable
CREATE TABLE "operational_fact_projections" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_fact_projections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operational_fact_projections_event_id_key" ON "operational_fact_projections"("event_id");

-- CreateIndex
CREATE INDEX "operational_fact_projections_organization_id_occurred_at_idx" ON "operational_fact_projections"("organization_id", "occurred_at");
