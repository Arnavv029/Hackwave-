-- CreateEnum
CREATE TYPE "RepairRuleStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ExecutionSource" AS ENUM ('OBSERVATION', 'MANUAL', 'FIXTURE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'REPAIR_RULE';
ALTER TYPE "AuditEntityType" ADD VALUE 'REPAIR_EXECUTION';

-- AlterEnum
ALTER TYPE "RepairKind" ADD VALUE 'ENUM_MAPPING';

-- AlterTable
ALTER TABLE "repair_proposals" ADD COLUMN     "adapterKey" TEXT,
ADD COLUMN     "derived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "endpointKey" TEXT,
ADD COLUMN     "impactReportId" UUID,
ADD COLUMN     "matchEvidence" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "ruleKey" TEXT,
ADD COLUMN     "ruleVersion" INTEGER;

-- CreateTable
CREATE TABLE "repair_rules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RepairRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "spec" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_executions" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "repairVersionId" UUID NOT NULL,
    "source" "ExecutionSource" NOT NULL,
    "observationId" UUID,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT,
    "ok" BOOLEAN NOT NULL,
    "output" JSONB,
    "rejections" JSONB NOT NULL DEFAULT '[]',
    "trace" JSONB NOT NULL DEFAULT '[]',
    "contractValid" BOOLEAN,
    "durationMs" INTEGER NOT NULL,
    "executedBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repair_rules_status_idx" ON "repair_rules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "repair_rules_key_version_key" ON "repair_rules"("key", "version");

-- CreateIndex
CREATE INDEX "repair_executions_proposalId_createdAt_idx" ON "repair_executions"("proposalId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "repair_executions_repairVersionId_ok_idx" ON "repair_executions"("repairVersionId", "ok");

-- CreateIndex
CREATE INDEX "repair_proposals_adapterKey_endpointKey_status_idx" ON "repair_proposals"("adapterKey", "endpointKey", "status");

-- AddForeignKey
ALTER TABLE "repair_executions" ADD CONSTRAINT "repair_executions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "repair_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_executions" ADD CONSTRAINT "repair_executions_repairVersionId_fkey" FOREIGN KEY ("repairVersionId") REFERENCES "repair_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
