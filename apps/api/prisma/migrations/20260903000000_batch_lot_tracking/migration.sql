-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LotOrigin" AS ENUM ('RECEIPT', 'OPENING', 'LEGACY_MIGRATION');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'LOT_MIGRATION';

-- DropIndex
DROP INDEX "inventory_balances_organization_id_product_id_variant_id_wa_key";

-- AlterTable
ALTER TABLE "inventory_balances" ADD COLUMN     "lot_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "inventory_movements" DROP COLUMN "batch_id",
ADD COLUMN     "lot_id" UUID;

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "manufactured_at" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "supplier_id" UUID,
    "status" "LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "origin" "LotOrigin" NOT NULL DEFAULT 'RECEIPT',
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_lots_organization_id_product_id_variant_id_idx" ON "inventory_lots"("organization_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "inventory_lots_organization_id_expiry_date_idx" ON "inventory_lots"("organization_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_organization_id_product_id_variant_id_lot_nu_key" ON "inventory_lots"("organization_id", "product_id", "variant_id", "lot_number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_organization_id_product_id_variant_id_wa_key" ON "inventory_balances"("organization_id", "product_id", "variant_id", "warehouse_id", "lot_id");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_lot_id_posted_at_idx" ON "inventory_movements"("organization_id", "lot_id", "posted_at");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

