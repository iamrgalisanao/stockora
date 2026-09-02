-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('PRODUCTS', 'SUPPLIERS', 'OPENING_INVENTORY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATED', 'COMMITTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'WARNING');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "source_file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "normalized_data" JSONB,
    "status" "ImportRowStatus" NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_organization_id_type_created_at_idx" ON "import_jobs"("organization_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "import_rows_job_id_row_number_idx" ON "import_rows"("job_id", "row_number");

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

