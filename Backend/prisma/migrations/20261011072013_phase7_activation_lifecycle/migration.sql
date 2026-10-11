-- CreateEnum
CREATE TYPE "ValidationRunStatus" AS ENUM ('PASSED', 'FAILED', 'ERROR');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "ActivationKind" AS ENUM ('ACTIVATE', 'ROLLBACK', 'AUTO_ROLLBACK', 'DEACTIVATE');

-- CreateEnum
CREATE TYPE "Initiator" AS ENUM ('HUMAN', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'VALIDATION_RUN';
ALTER TYPE "AuditEntityType" ADD VALUE 'ACTIVATION';
ALTER TYPE "AuditEntityType" ADD VALUE 'VERIFICATION_RUN';

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "testKey" TEXT,
ADD COLUMN     "validationRunId" UUID;

-- CreateTable
CREATE TABLE "repair_validation_runs" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "repairVersionId" UUID NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ValidationRunStatus" NOT NULL,
    "stages" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "reportHash" TEXT NOT NULL,
    "totalTests" INTEGER NOT NULL,
    "mandatoryFailures" INTEGER NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_approvals" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "repairVersionId" UUID NOT NULL,
    "validationRunId" UUID,
    "actor" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adapter_activations" (
    "id" UUID NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "activeVersionId" UUID,
    "previousVersionId" UUID,
    "lastGoodVersionId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "safety" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adapter_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_events" (
    "id" UUID NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "kind" "ActivationKind" NOT NULL,
    "fromVersionId" UUID,
    "toVersionId" UUID,
    "proposalId" UUID,
    "revision" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "initiator" "Initiator" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_runs" (
    "id" UUID NOT NULL,
    "activationEventId" UUID NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "endpointKey" TEXT NOT NULL,
    "versionId" UUID NOT NULL,
    "probes" INTEGER NOT NULL,
    "probeErrors" INTEGER NOT NULL,
    "contractViolations" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "thresholds" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'NONE',
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repair_validation_runs_proposalId_createdAt_idx" ON "repair_validation_runs"("proposalId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "repair_validation_runs_repairVersionId_status_idx" ON "repair_validation_runs"("repairVersionId", "status");

-- CreateIndex
CREATE INDEX "repair_approvals_proposalId_createdAt_idx" ON "repair_approvals"("proposalId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "adapter_activations_adapterKey_endpointKey_key" ON "adapter_activations"("adapterKey", "endpointKey");

-- CreateIndex
CREATE INDEX "activation_events_adapterKey_endpointKey_createdAt_idx" ON "activation_events"("adapterKey", "endpointKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "activation_events_proposalId_idx" ON "activation_events"("proposalId");

-- CreateIndex
CREATE INDEX "verification_runs_adapterKey_endpointKey_createdAt_idx" ON "verification_runs"("adapterKey", "endpointKey", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "test_runs_validationRunId_idx" ON "test_runs"("validationRunId");

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_activationEventId_fkey" FOREIGN KEY ("activationEventId") REFERENCES "activation_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
