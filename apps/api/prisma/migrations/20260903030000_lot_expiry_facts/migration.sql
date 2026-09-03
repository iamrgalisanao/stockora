-- CreateEnum
CREATE TYPE "ExpiryEventType" AS ENUM ('LOT_EXPIRING_SOON', 'LOT_EXPIRED');

-- AlterTable
ALTER TABLE "inventory_balances" ALTER COLUMN "lot_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- CreateTable
CREATE TABLE "lot_expiry_facts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" "ExpiryEventType" NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "days_remaining" INTEGER NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_expiry_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lot_expiry_facts_organization_id_event_type_detected_at_idx" ON "lot_expiry_facts"("organization_id", "event_type", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "lot_expiry_facts_organization_id_lot_id_warehouse_id_event__key" ON "lot_expiry_facts"("organization_id", "lot_id", "warehouse_id", "event_type");

