-- Products/variants lifecycle status + ProductBarcode (multi-barcode identity). ADR 0003 / 2A.1B.
CREATE TYPE "BarcodeType" AS ENUM ('STANDARD', 'INTERNAL');

DROP INDEX "products_organization_id_barcode_idx";
DROP INDEX "products_organization_id_is_active_idx";

-- product_variants: add lifecycle, backfill from is_active (drop legacy cols after barcode backfill)
ALTER TABLE "product_variants"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;
UPDATE "product_variants" SET "status" = 'INACTIVE' WHERE "is_active" = false;

-- products: add lifecycle, backfill
ALTER TABLE "products"
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "archived_by_id" UUID;
UPDATE "products" SET "status" = 'INACTIVE' WHERE "is_active" = false;

-- product_barcodes
CREATE TABLE "product_barcodes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "code" TEXT NOT NULL,
    "barcode_type" "BarcodeType" NOT NULL DEFAULT 'STANDARD',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_barcodes_organization_id_product_id_idx" ON "product_barcodes"("organization_id", "product_id");
CREATE UNIQUE INDEX "product_barcodes_organization_id_code_key" ON "product_barcodes"("organization_id", "code");
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "products_organization_id_status_idx" ON "products"("organization_id", "status");

-- Backfill barcodes from the legacy single-barcode columns (primary, standard).
INSERT INTO "product_barcodes" ("id","organization_id","product_id","variant_id","code","barcode_type","is_primary","status","created_at","updated_at")
SELECT gen_random_uuid(), "organization_id", "id", NULL, "barcode", 'STANDARD', true, 'ACTIVE', now(), now()
FROM "products" WHERE "barcode" IS NOT NULL AND "barcode" <> ''
ON CONFLICT ("organization_id","code") DO NOTHING;

INSERT INTO "product_barcodes" ("id","organization_id","product_id","variant_id","code","barcode_type","is_primary","status","created_at","updated_at")
SELECT gen_random_uuid(), pv."organization_id", pv."product_id", pv."id", pv."barcode", 'STANDARD', true, 'ACTIVE', now(), now()
FROM "product_variants" pv WHERE pv."barcode" IS NOT NULL AND pv."barcode" <> ''
ON CONFLICT ("organization_id","code") DO NOTHING;

-- Drop legacy columns.
ALTER TABLE "products" DROP COLUMN "barcode", DROP COLUMN "is_active";
ALTER TABLE "product_variants" DROP COLUMN "barcode", DROP COLUMN "is_active";
