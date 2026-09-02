-- AlterTable
ALTER TABLE "stock_release_items" ADD COLUMN     "reservation_line_id" UUID;

-- CreateIndex
CREATE INDEX "stock_release_items_reservation_line_id_idx" ON "stock_release_items"("reservation_line_id");

-- AddForeignKey
ALTER TABLE "stock_release_items" ADD CONSTRAINT "stock_release_items_reservation_line_id_fkey" FOREIGN KEY ("reservation_line_id") REFERENCES "reservation_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

