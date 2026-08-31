-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALES_RELEASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'STOCK_ADJUSTMENT_IN', 'STOCK_ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRY', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT', 'PROJECT_ISSUE', 'INTERNAL_CONSUMPTION');

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "txn_number" TEXT NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID NOT NULL,
    "on_hand_delta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reserved_delta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "in_transit_delta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quarantined_delta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged_delta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batch_id" UUID,
    "serial_id" UUID,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "idempotency_key" TEXT,
    "reversal_of_id" UUID,
    "performed_by_id" UUID,
    "approved_by_id" UUID,
    "reason" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "on_hand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "in_transit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quarantined" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("organization_id","key")
);

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_product_id_posted_at_idx" ON "inventory_movements"("organization_id", "product_id", "posted_at");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_warehouse_id_posted_at_idx" ON "inventory_movements"("organization_id", "warehouse_id", "posted_at");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_reference_type_referenc_idx" ON "inventory_movements"("organization_id", "reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_organization_id_idempotency_key_key" ON "inventory_movements"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "inventory_balances_organization_id_warehouse_id_idx" ON "inventory_balances"("organization_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "inventory_balances_organization_id_product_id_idx" ON "inventory_balances"("organization_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_organization_id_product_id_variant_id_wa_key" ON "inventory_balances"("organization_id", "product_id", "variant_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
