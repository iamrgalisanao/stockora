-- CreateEnum
CREATE TYPE "AllocationStrategy" AS ENUM ('MANUAL', 'FEFO');

-- AlterTable
ALTER TABLE "inventory_balances" ALTER COLUMN "lot_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- CreateTable
CREATE TABLE "shelf_life_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "expiry_tracking_required" BOOLEAN NOT NULL DEFAULT false,
    "minimum_shelf_life_on_receipt_days" INTEGER,
    "expiring_soon_days" INTEGER,
    "allocation_strategy" "AllocationStrategy" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shelf_life_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shelf_life_policies_organization_id_product_id_idx" ON "shelf_life_policies"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "shelf_life_policies_organization_id_product_id_variant_id_key" ON "shelf_life_policies"("organization_id", "product_id", "variant_id");

-- AddForeignKey
ALTER TABLE "shelf_life_policies" ADD CONSTRAINT "shelf_life_policies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

