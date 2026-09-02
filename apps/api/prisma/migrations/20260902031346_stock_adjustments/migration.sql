-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_SECOND_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "adjustment_reasons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requires_evidence" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustment_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "adjustment_number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reason_id" UUID,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "requires_second_approval" BOOLEAN NOT NULL DEFAULT false,
    "estimated_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "requestor_id" UUID,
    "first_approved_by_id" UUID,
    "second_approved_by_id" UUID,
    "notes" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "direction" "AdjustmentDirection" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "location_id" UUID,
    "remarks" TEXT,

    CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_reasons_organization_id_code_key" ON "adjustment_reasons"("organization_id", "code");

-- CreateIndex
CREATE INDEX "stock_adjustments_organization_id_status_idx" ON "stock_adjustments"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_organization_id_adjustment_number_key" ON "stock_adjustments"("organization_id", "adjustment_number");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_adjustment_id_idx" ON "stock_adjustment_items"("adjustment_id");

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "adjustment_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
