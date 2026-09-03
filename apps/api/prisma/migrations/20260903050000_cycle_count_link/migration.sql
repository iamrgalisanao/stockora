-- Cycle-counting linkage (2C.3B, ADR 0009 §6): the one authoritative StockCount for a CycleCountTask.
-- AlterTable
ALTER TABLE "stock_counts" ADD COLUMN     "cycle_count_task_id" UUID;

-- CreateIndex (unique — at most one count attaches to a task; NULLs stay distinct for ordinary counts)
CREATE UNIQUE INDEX "stock_counts_cycle_count_task_id_key" ON "stock_counts"("cycle_count_task_id");
