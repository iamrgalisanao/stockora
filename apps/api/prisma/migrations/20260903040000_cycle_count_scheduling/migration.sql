-- CreateEnum
CREATE TYPE "ABCClass" AS ENUM ('A', 'B', 'C', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "ClassificationStrategy" AS ENUM ('MANUAL', 'MOVEMENT_VELOCITY', 'INVENTORY_VALUE');

-- CreateEnum
CREATE TYPE "CycleCountTaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CycleCountSource" AS ENUM ('SCHEDULED', 'AD_HOC', 'RECOUNT');

-- AlterTable
ALTER TABLE "inventory_balances" ALTER COLUMN "lot_id" SET DEFAULT '00000000-0000-0000-0000-000000000000';

-- CreateTable
CREATE TABLE "cycle_count_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "strategy" "ClassificationStrategy" NOT NULL DEFAULT 'MOVEMENT_VELOCITY',
    "a_frequency_days" INTEGER NOT NULL DEFAULT 30,
    "b_frequency_days" INTEGER NOT NULL DEFAULT 90,
    "c_frequency_days" INTEGER NOT NULL DEFAULT 180,
    "lookback_days" INTEGER NOT NULL DEFAULT 90,
    "a_percent" INTEGER NOT NULL DEFAULT 20,
    "b_percent" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_count_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_classifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "abc_class" "ABCClass" NOT NULL DEFAULT 'UNCLASSIFIED',
    "strategy" "ClassificationStrategy" NOT NULL,
    "score" DECIMAL(18,4),
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "classified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_count_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "lot_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "abc_class" "ABCClass" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "policy_context" JSONB,
    "status" "CycleCountTaskStatus" NOT NULL DEFAULT 'PENDING',
    "source" "CycleCountSource" NOT NULL DEFAULT 'SCHEDULED',
    "due_at" TIMESTAMP(3) NOT NULL,
    "assigned_to_id" UUID,
    "physical_count_id" UUID,
    "supersedes_task_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_count_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cycle_count_policies_organization_id_warehouse_id_key" ON "cycle_count_policies"("organization_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "product_classifications_organization_id_warehouse_id_abc_cl_idx" ON "product_classifications"("organization_id", "warehouse_id", "abc_class");

-- CreateIndex
CREATE UNIQUE INDEX "product_classifications_organization_id_warehouse_id_produc_key" ON "product_classifications"("organization_id", "warehouse_id", "product_id", "variant_id");

-- CreateIndex
CREATE INDEX "cycle_count_tasks_organization_id_warehouse_id_status_idx" ON "cycle_count_tasks"("organization_id", "warehouse_id", "status");

-- CreateIndex
CREATE INDEX "cycle_count_tasks_organization_id_status_due_at_idx" ON "cycle_count_tasks"("organization_id", "status", "due_at");

-- AddForeignKey
ALTER TABLE "product_classifications" ADD CONSTRAINT "product_classifications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_count_tasks" ADD CONSTRAINT "cycle_count_tasks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Partial unique index (ADR 0009 §7): at most ONE active task per counting scope.
-- Hand-authored — Prisma cannot express a status-filtered unique index.
CREATE UNIQUE INDEX "cycle_count_tasks_active_scope_key"
  ON "cycle_count_tasks" ("organization_id", "warehouse_id", "product_id", "variant_id", "lot_id")
  WHERE "status" IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS');
