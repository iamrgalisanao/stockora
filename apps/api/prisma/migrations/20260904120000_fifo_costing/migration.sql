-- FIFO Costing (Phase 2D.5A, ADR 0013): cost layers, consumptions, and strategy policy.
CREATE TYPE "CostingStrategy" AS ENUM ('WAC', 'FIFO');
CREATE TYPE "CostLayerStatus" AS ENUM ('OPEN', 'DEPLETED');

CREATE TABLE "costing_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "strategy" "CostingStrategy" NOT NULL DEFAULT 'WAC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "costing_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "costing_policies_organization_id_product_id_key" ON "costing_policies"("organization_id", "product_id");

CREATE TABLE "cost_layers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "warehouse_id" UUID NOT NULL,
    "source_movement_id" UUID NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "remaining_quantity" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "CostLayerStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_layers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cost_layers_org_prod_var_wh_status_recv_id_idx" ON "cost_layers"("organization_id", "product_id", "variant_id", "warehouse_id", "status", "received_at", "id");
CREATE INDEX "cost_layers_organization_id_source_movement_id_idx" ON "cost_layers"("organization_id", "source_movement_id");

CREATE TABLE "cost_layer_consumptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cost_layer_id" UUID NOT NULL,
    "outbound_movement_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "extended_cost" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_layer_consumptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cost_layer_consumptions_organization_id_outbound_movement_id_idx" ON "cost_layer_consumptions"("organization_id", "outbound_movement_id");
CREATE INDEX "cost_layer_consumptions_cost_layer_id_idx" ON "cost_layer_consumptions"("cost_layer_id");

ALTER TABLE "cost_layer_consumptions" ADD CONSTRAINT "cost_layer_consumptions_cost_layer_id_fkey" FOREIGN KEY ("cost_layer_id") REFERENCES "cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
