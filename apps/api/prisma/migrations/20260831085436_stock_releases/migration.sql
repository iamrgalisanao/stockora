-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'FOR_APPROVAL', 'APPROVED', 'RELEASED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stock_releases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "release_number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "purpose" TEXT,
    "destination_type" TEXT NOT NULL DEFAULT 'INTERNAL_CONSUMPTION',
    "destination_ref" TEXT,
    "reference" TEXT,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "requestor_id" UUID,
    "approved_by_id" UUID,
    "released_by_id" UUID,
    "notes" TEXT,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_release_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "requested_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "approved_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "released_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "location_id" UUID,
    "remarks" TEXT,

    CONSTRAINT "stock_release_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_releases_organization_id_status_idx" ON "stock_releases"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_releases_organization_id_release_number_key" ON "stock_releases"("organization_id", "release_number");

-- CreateIndex
CREATE INDEX "stock_release_items_release_id_idx" ON "stock_release_items"("release_id");

-- AddForeignKey
ALTER TABLE "stock_releases" ADD CONSTRAINT "stock_releases_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_release_items" ADD CONSTRAINT "stock_release_items_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "stock_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_release_items" ADD CONSTRAINT "stock_release_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
