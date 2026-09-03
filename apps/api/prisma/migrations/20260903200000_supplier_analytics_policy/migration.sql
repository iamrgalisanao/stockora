-- Org-level supplier-scoring weights (2D.4B).
CREATE TABLE "supplier_analytics_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "fill_rate_weight" DECIMAL(9,4) NOT NULL DEFAULT 0.25,
    "on_time_weight" DECIMAL(9,4) NOT NULL DEFAULT 0.20,
    "lead_time_weight" DECIMAL(9,4) NOT NULL DEFAULT 0.20,
    "price_weight" DECIMAL(9,4) NOT NULL DEFAULT 0.20,
    "quality_weight" DECIMAL(9,4) NOT NULL DEFAULT 0.15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_analytics_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_analytics_policies_organization_id_key" ON "supplier_analytics_policies"("organization_id");
