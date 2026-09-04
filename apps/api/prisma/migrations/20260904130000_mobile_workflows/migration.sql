-- AlterTable
ALTER TABLE "cost_layers" ALTER COLUMN "variant_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "costing_policies" ALTER COLUMN "product_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "cycle_count_policies" ALTER COLUMN "warehouse_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "cycle_count_tasks" ALTER COLUMN "variant_id" SET DEFAULT '00000000-0000-0000-0000-000000000000',
ALTER COLUMN "lot_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "inventory_balances" ALTER COLUMN "lot_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "inventory_serials" ALTER COLUMN "variant_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- AlterTable
ALTER TABLE "product_classifications" ALTER COLUMN "variant_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- CreateTable
CREATE TABLE "mobile_work_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "work_type" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "claimed_by_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_work_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_commands" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "command_type" TEXT NOT NULL,
    "aggregate_id" TEXT,
    "expected_version" BIGINT,
    "schema_version" INTEGER NOT NULL,
    "app_version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "apply_status" TEXT NOT NULL DEFAULT 'ACKNOWLEDGED',
    "captured_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_work_claims_organization_id_claimed_by_id_idx" ON "mobile_work_claims"("organization_id", "claimed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_work_claims_organization_id_work_type_document_id_key" ON "mobile_work_claims"("organization_id", "work_type", "document_id");

-- CreateIndex
CREATE INDEX "mobile_commands_organization_id_warehouse_id_apply_status_idx" ON "mobile_commands"("organization_id", "warehouse_id", "apply_status");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_commands_organization_id_idempotency_key_key" ON "mobile_commands"("organization_id", "idempotency_key");

-- RenameIndex
ALTER INDEX "cost_layer_consumptions_organization_id_outbound_movement_id_id" RENAME TO "cost_layer_consumptions_organization_id_outbound_movement_i_idx";

-- RenameIndex
ALTER INDEX "cost_layers_org_prod_var_wh_status_recv_id_idx" RENAME TO "cost_layers_organization_id_product_id_variant_id_warehouse_idx";
