-- Optional supplier-analytics capture on goods receipts (2D.4): order date + expected delivery date.
ALTER TABLE "goods_receipts" ADD COLUMN "order_date" TIMESTAMP(3);
ALTER TABLE "goods_receipts" ADD COLUMN "expected_delivery_date" TIMESTAMP(3);
