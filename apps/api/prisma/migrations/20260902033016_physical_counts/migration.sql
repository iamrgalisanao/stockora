-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('COUNTING', 'REVIEW', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountType" AS ENUM ('FULL', 'CYCLE', 'WAREHOUSE', 'CATEGORY', 'BIN', 'RANDOM');

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "count_number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "CountType" NOT NULL DEFAULT 'WAREHOUSE',
    "is_blind" BOOLEAN NOT NULL DEFAULT false,
    "status" "CountStatus" NOT NULL DEFAULT 'COUNTING',
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "requestor_id" UUID,
    "approved_by_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "system_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "counted_qty" DECIMAL(18,4),
    "recount_qty" DECIMAL(18,4),
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_counts_organization_id_status_idx" ON "stock_counts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_organization_id_count_number_key" ON "stock_counts"("organization_id", "count_number");

-- CreateIndex
CREATE INDEX "stock_count_items_count_id_idx" ON "stock_count_items"("count_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
