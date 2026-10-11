-- CreateEnum
CREATE TYPE "AiProposalStatus" AS ENUM ('PENDING_REVIEW', 'NEEDS_INFORMATION', 'REJECTED_BY_POLICY', 'FAILED_VALIDATION', 'PROVIDER_ERROR', 'PROMOTED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'AI_PROPOSAL';

-- CreateTable
CREATE TABLE "ai_proposals" (
    "id" UUID NOT NULL,
    "findingId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AiProposalStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestId" TEXT,
    "usage" JSONB,
    "latencyMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "inputRefs" JSONB NOT NULL,
    "proposal" JSONB,
    "compiledTransform" JSONB,
    "policyIssues" JSONB NOT NULL DEFAULT '[]',
    "validation" JSONB,
    "risk" "RiskLevel" NOT NULL DEFAULT 'HIGH',
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "errorCategory" TEXT,
    "errorMessage" TEXT,
    "ruleId" UUID,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_proposals_status_createdAt_idx" ON "ai_proposals"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_proposals_findingId_version_key" ON "ai_proposals"("findingId", "version");

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
