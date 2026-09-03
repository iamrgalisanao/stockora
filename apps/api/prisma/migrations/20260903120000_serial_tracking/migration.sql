-- Serial tracking (Phase 2D.3A, ADR 0012).
-- CreateEnum
CREATE TYPE "SerialCaptureMode" AS ENUM ('RECEIPT', 'ISSUE');
CREATE TYPE "SerialStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'IN_TRANSIT', 'QUARANTINED', 'DAMAGED', 'ISSUED', 'DISPOSED');

-- AlterTable: serials captured on the goods-receipt line.
ALTER TABLE "goods_receipt_items" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: per-product capture policy.
CREATE TABLE "serial_tracking_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "capture_mode" "SerialCaptureMode" NOT NULL DEFAULT 'RECEIPT',
    "require_lot_when_batch_tracked" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "serial_tracking_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "serial_tracking_policies_organization_id_product_id_key" ON "serial_tracking_policies"("organization_id", "product_id");

-- CreateTable: the serial registry.
CREATE TABLE "inventory_serials" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "serial_number" TEXT NOT NULL,
    "lot_id" UUID,
    "status" "SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "current_warehouse_id" UUID,
    "current_location_id" UUID,
    "last_movement_id" UUID,
    "received_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_serials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_serials_organization_id_product_id_variant_id_seri_key" ON "inventory_serials"("organization_id", "product_id", "variant_id", "serial_number");
CREATE INDEX "inventory_serials_organization_id_product_id_status_idx" ON "inventory_serials"("organization_id", "product_id", "status");
CREATE INDEX "inventory_serials_organization_id_current_warehouse_id_status_idx" ON "inventory_serials"("organization_id", "current_warehouse_id", "status");
CREATE INDEX "inventory_serials_organization_id_lot_id_idx" ON "inventory_serials"("organization_id", "lot_id");

-- AddForeignKey
ALTER TABLE "inventory_serials" ADD CONSTRAINT "inventory_serials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
