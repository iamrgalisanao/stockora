-- 2D.6C: mobile command apply outcomes + dependency chains (ADR 0014).
ALTER TABLE "mobile_commands"
  ADD COLUMN "depends_on_command_id" UUID,
  ADD COLUMN "code" TEXT,
  ADD COLUMN "message" TEXT,
  ADD COLUMN "resolution" TEXT,
  ADD COLUMN "current_state" JSONB,
  ADD COLUMN "aggregate_version_after" BIGINT,
  ADD COLUMN "applied_at" TIMESTAMP(3);
