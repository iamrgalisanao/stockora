-- Serial propagation (Phase 2D.3B, ADR 0012): serial arrays on the document items that move serial state.

-- AlterTable
ALTER TABLE "stock_release_items" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "stock_transfer_items" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "stock_adjustment_items" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "stock_count_items"
  ADD COLUMN "expected_serials" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "observed_serials" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "return_lines" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "return_dispositions" ADD COLUMN "serial_numbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- RenameIndex: align 2D.3A serial index names to Prisma's canonical truncation.
ALTER INDEX "inventory_serials_organization_id_current_warehouse_id_status_i" RENAME TO "inventory_serials_organization_id_current_warehouse_id_stat_idx";
ALTER INDEX "inventory_serials_organization_id_product_id_variant_id_seri_ke" RENAME TO "inventory_serials_organization_id_product_id_variant_id_ser_key";
