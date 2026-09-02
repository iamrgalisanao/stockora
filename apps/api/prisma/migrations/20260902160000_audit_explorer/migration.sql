-- 2A.1F: Audit Explorer read-model — enrich audit_logs with correlation, source, actor/entity
-- snapshots, and a warehouse dimension. Purely additive; existing rows keep NULL/defaults.

CREATE TYPE "AuditSource" AS ENUM ('USER', 'SYSTEM', 'IMPORT', 'API', 'INTEGRATION', 'SCHEDULED_JOB');

ALTER TABLE "audit_logs"
  ADD COLUMN "actor_display_name" TEXT,
  ADD COLUMN "source" "AuditSource" NOT NULL DEFAULT 'USER',
  ADD COLUMN "entity_display" TEXT,
  ADD COLUMN "warehouse_id" UUID,
  ADD COLUMN "correlation_id" UUID;

-- Investigation-shaped indexes (drop the narrower legacy entity index in favor of the timestamped one).
DROP INDEX "audit_logs_organization_id_entity_type_entity_id_idx";
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_created_at_idx"
  ON "audit_logs" ("organization_id", "entity_type", "entity_id", "created_at");
CREATE INDEX "audit_logs_organization_id_user_id_created_at_idx"
  ON "audit_logs" ("organization_id", "user_id", "created_at");
CREATE INDEX "audit_logs_organization_id_action_created_at_idx"
  ON "audit_logs" ("organization_id", "action", "created_at");
CREATE INDEX "audit_logs_organization_id_warehouse_id_created_at_idx"
  ON "audit_logs" ("organization_id", "warehouse_id", "created_at");
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs" ("correlation_id");
