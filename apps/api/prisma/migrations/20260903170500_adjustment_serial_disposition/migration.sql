-- Serialized OUT adjustments can target DAMAGED instead of the default DISPOSED (2D.3B, ADR 0012).
ALTER TABLE "stock_adjustment_items" ADD COLUMN "serial_disposition" TEXT;
