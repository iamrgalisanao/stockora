-- AlterTable
ALTER TABLE "inventory_balances" ALTER COLUMN "lot_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "return_lines" ADD COLUMN     "lot_id" UUID;

-- AlterTable
ALTER TABLE "stock_adjustment_items" ADD COLUMN     "lot_id" UUID;

-- AlterTable
ALTER TABLE "stock_count_items" ADD COLUMN     "lot_id" UUID;

-- AlterTable
ALTER TABLE "stock_transfer_items" ADD COLUMN     "lot_id" UUID;

-- CreateTable
CREATE TABLE "release_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "release_item_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "release_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "release_allocations_release_item_id_idx" ON "release_allocations"("release_item_id");

-- AddForeignKey
ALTER TABLE "release_allocations" ADD CONSTRAINT "release_allocations_release_item_id_fkey" FOREIGN KEY ("release_item_id") REFERENCES "stock_release_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

