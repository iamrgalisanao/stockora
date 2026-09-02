-- 2A.1D: Suppliers & supplier-products adopt the EntityStatus lifecycle (replacing is_active).
-- Data-preserving: add status columns, backfill from is_active, then drop is_active + swap index.

-- suppliers -----------------------------------------------------------------
ALTER TABLE "suppliers"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;

UPDATE "suppliers" SET "status" = 'INACTIVE' WHERE "is_active" = false;

DROP INDEX "suppliers_organization_id_is_active_idx";
ALTER TABLE "suppliers" DROP COLUMN "is_active";
CREATE INDEX "suppliers_organization_id_status_idx" ON "suppliers"("organization_id", "status");

-- supplier_products ---------------------------------------------------------
ALTER TABLE "supplier_products"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3);

UPDATE "supplier_products" SET "status" = 'INACTIVE' WHERE "is_active" = false;

ALTER TABLE "supplier_products" DROP COLUMN "is_active";
