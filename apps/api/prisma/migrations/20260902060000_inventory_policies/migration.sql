-- Warehouse-level InventoryPolicy replaces product-level reorder fields (ADR 0002 §2A.1C).
CREATE TABLE "inventory_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "min_stock" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "max_stock" DECIMAL(18,4),
    "reorder_point" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reorder_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "preferred_supplier_id" UUID,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_policies_organization_id_product_id_idx" ON "inventory_policies"("organization_id", "product_id");
CREATE INDEX "inventory_policies_organization_id_warehouse_id_idx" ON "inventory_policies"("organization_id", "warehouse_id");
CREATE UNIQUE INDEX "inventory_policies_organization_id_warehouse_id_product_id__key" ON "inventory_policies"("organization_id", "warehouse_id", "product_id", "variant_id");
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_policies" ADD CONSTRAINT "inventory_policies_preferred_supplier_id_fkey" FOREIGN KEY ("preferred_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one policy per (warehouse, product, variant) where a balance exists and the product had a reorder point.
INSERT INTO "inventory_policies" ("id","organization_id","warehouse_id","product_id","variant_id","min_stock","max_stock","reorder_point","reorder_quantity","preferred_supplier_id","status","created_at","updated_at")
SELECT gen_random_uuid(), b."organization_id", b."warehouse_id", p."id", b."variant_id",
       p."min_stock", NULLIF(p."max_stock", 0), p."reorder_point",
       CASE WHEN p."reorder_qty" > 0 THEN p."reorder_qty" ELSE p."reorder_point" END,
       p."preferred_supplier_id", 'ACTIVE', now(), now()
FROM "products" p
JOIN "inventory_balances" b ON b."product_id" = p."id" AND b."organization_id" = p."organization_id"
WHERE p."reorder_point" > 0
ON CONFLICT ("organization_id","warehouse_id","product_id","variant_id") DO NOTHING;

-- Fallback: products with a reorder point but no balance anywhere -> the org's default warehouse (product-level).
INSERT INTO "inventory_policies" ("id","organization_id","warehouse_id","product_id","variant_id","min_stock","max_stock","reorder_point","reorder_quantity","preferred_supplier_id","status","created_at","updated_at")
SELECT gen_random_uuid(), p."organization_id", w."id", p."id", '00000000-0000-0000-0000-000000000000',
       p."min_stock", NULLIF(p."max_stock", 0), p."reorder_point",
       CASE WHEN p."reorder_qty" > 0 THEN p."reorder_qty" ELSE p."reorder_point" END,
       p."preferred_supplier_id", 'ACTIVE', now(), now()
FROM "products" p
JOIN "warehouses" w ON w."organization_id" = p."organization_id" AND w."is_default" = true
WHERE p."reorder_point" > 0
  AND NOT EXISTS (SELECT 1 FROM "inventory_balances" b WHERE b."product_id" = p."id")
ON CONFLICT ("organization_id","warehouse_id","product_id","variant_id") DO NOTHING;

-- Drop the migrated product-level reorder columns.
ALTER TABLE "products" DROP COLUMN "min_stock", DROP COLUMN "max_stock", DROP COLUMN "reorder_point", DROP COLUMN "reorder_qty";
