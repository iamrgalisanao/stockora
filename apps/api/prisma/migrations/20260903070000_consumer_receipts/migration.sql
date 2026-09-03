-- Per-consumer delivery receipts (Phase 2D.1B, ADR 0010).
-- CreateTable
CREATE TABLE "consumer_receipts" (
    "id" UUID NOT NULL,
    "consumer_name" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consumer_receipts_consumer_name_event_id_key" ON "consumer_receipts"("consumer_name", "event_id");
