-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('DRAFT', 'RESERVED', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('MANUAL', 'INTERNAL_REQUEST', 'EXTERNAL');

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reservation_no" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "source_type" "ReservationSource" NOT NULL DEFAULT 'MANUAL',
    "source_id" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'DRAFT',
    "expires_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_lines" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "consumed_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "reservation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_reservations_organization_id_status_idx" ON "inventory_reservations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_organization_id_warehouse_id_status_idx" ON "inventory_reservations"("organization_id", "warehouse_id", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_organization_id_expires_at_idx" ON "inventory_reservations"("organization_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_organization_id_reservation_no_key" ON "inventory_reservations"("organization_id", "reservation_no");

-- CreateIndex
CREATE INDEX "reservation_lines_reservation_id_idx" ON "reservation_lines"("reservation_id");

-- CreateIndex
CREATE INDEX "reservation_lines_product_id_variant_id_idx" ON "reservation_lines"("product_id", "variant_id");

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_lines" ADD CONSTRAINT "reservation_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "inventory_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_lines" ADD CONSTRAINT "reservation_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

