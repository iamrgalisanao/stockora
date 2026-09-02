-- Catalog lifecycle: replace is_active boolean with the 3-state EntityStatus (ADR 0003).
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- brands
ALTER TABLE "brands"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;
UPDATE "brands" SET "status" = 'INACTIVE' WHERE "is_active" = false;
ALTER TABLE "brands" DROP COLUMN "is_active";

-- product_categories
ALTER TABLE "product_categories"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;
UPDATE "product_categories" SET "status" = 'INACTIVE' WHERE "is_active" = false;
ALTER TABLE "product_categories" DROP COLUMN "is_active";

-- units_of_measure
ALTER TABLE "units_of_measure"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;
UPDATE "units_of_measure" SET "status" = 'INACTIVE' WHERE "is_active" = false;
ALTER TABLE "units_of_measure" DROP COLUMN "is_active";
