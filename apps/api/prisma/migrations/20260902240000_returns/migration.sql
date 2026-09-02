-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('DRAFT', 'RECEIVED', 'PARTIALLY_DISPOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispositionType" AS ENUM ('RESTOCK', 'DAMAGED', 'RETURN_TO_SUPPLIER', 'DISPOSE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MovementType" ADD VALUE 'RETURN_RECEIPT';
ALTER TYPE "MovementType" ADD VALUE 'RETURN_RESTOCK';
ALTER TYPE "MovementType" ADD VALUE 'RETURN_DISPOSE';

-- CreateTable
CREATE TABLE "inventory_returns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "type" "ReturnType" NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "source_reference" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "disposed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_dispositions" (
    "id" UUID NOT NULL,
    "return_line_id" UUID NOT NULL,
    "type" "DispositionType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "performed_by_id" UUID,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_returns_organization_id_status_idx" ON "inventory_returns"("organization_id", "status");

-- CreateIndex
CREATE INDEX "inventory_returns_organization_id_warehouse_id_status_idx" ON "inventory_returns"("organization_id", "warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_returns_organization_id_return_no_key" ON "inventory_returns"("organization_id", "return_no");

-- CreateIndex
CREATE INDEX "return_lines_return_id_idx" ON "return_lines"("return_id");

-- CreateIndex
CREATE INDEX "return_lines_product_id_variant_id_idx" ON "return_lines"("product_id", "variant_id");

-- CreateIndex
CREATE INDEX "return_dispositions_return_line_id_idx" ON "return_dispositions"("return_line_id");

-- AddForeignKey
ALTER TABLE "inventory_returns" ADD CONSTRAINT "inventory_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "inventory_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_dispositions" ADD CONSTRAINT "return_dispositions_return_line_id_fkey" FOREIGN KEY ("return_line_id") REFERENCES "return_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

