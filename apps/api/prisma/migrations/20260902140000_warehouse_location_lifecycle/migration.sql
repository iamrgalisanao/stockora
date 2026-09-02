-- 2A.1E: Warehouses & locations adopt the EntityStatus lifecycle; locations gain a
-- generic `usage` classification. Data-preserving throughout.

-- New enum for operational location eligibility.
CREATE TYPE "LocationUsage" AS ENUM ('STORAGE', 'RECEIVING', 'STAGING', 'QUARANTINE', 'DAMAGED', 'DISPATCH', 'OTHER');

-- warehouses: WarehouseStatus -> EntityStatus (ACTIVE/INACTIVE carry over; adds ARCHIVED) --
ALTER TABLE "warehouses" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "warehouses" ALTER COLUMN "status" TYPE "EntityStatus" USING ("status"::text::"EntityStatus");
ALTER TABLE "warehouses" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "warehouses"
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;

-- WarehouseStatus is now unused.
DROP TYPE "WarehouseStatus";

-- warehouse_locations: is_active -> status; is_receiving_area -> usage --
ALTER TABLE "warehouse_locations"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "usage" "LocationUsage" NOT NULL DEFAULT 'STORAGE';

UPDATE "warehouse_locations" SET "status" = 'INACTIVE' WHERE "is_active" = false;
UPDATE "warehouse_locations" SET "usage" = 'RECEIVING' WHERE "is_receiving_area" = true;

ALTER TABLE "warehouse_locations" DROP COLUMN "is_active";
ALTER TABLE "warehouse_locations" DROP COLUMN "is_receiving_area";
