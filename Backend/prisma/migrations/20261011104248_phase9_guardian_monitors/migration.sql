-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "MonitorAuthType" AS ENUM ('NONE', 'BEARER', 'API_KEY', 'BASIC');

-- CreateEnum
CREATE TYPE "MonitorBaselineStatus" AS ENUM ('PENDING', 'APPROVED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MonitorIncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'AWAITING_FIX', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RecoveryProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROMOTED', 'ROLLED_BACK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'MONITOR';
ALTER TYPE "AuditEntityType" ADD VALUE 'MONITOR_BASELINE';
ALTER TYPE "AuditEntityType" ADD VALUE 'MONITOR_INCIDENT';
ALTER TYPE "AuditEntityType" ADD VALUE 'RECOVERY_PROPOSAL';
ALTER TYPE "AuditEntityType" ADD VALUE 'FEATURE_MAPPING';
ALTER TYPE "AuditEntityType" ADD VALUE 'SETTINGS';

-- CreateTable
CREATE TABLE "monitors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "environment" TEXT NOT NULL DEFAULT 'Production',
    "description" TEXT NOT NULL DEFAULT '',
    "intervalSec" INTEGER NOT NULL DEFAULT 300,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "authType" "MonitorAuthType" NOT NULL DEFAULT 'NONE',
    "authHeader" TEXT,
    "authSecretEnc" TEXT,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "body" JSONB,
    "expectedStatus" INTEGER,
    "autoBaseline" BOOLEAN NOT NULL DEFAULT true,
    "status" "MonitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "nextRunAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastOutcome" TEXT,
    "lastStatusCode" INTEGER,
    "lastLatencyMs" INTEGER,
    "activeProposalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_checks" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "responseBytes" INTEGER NOT NULL DEFAULT 0,
    "parseOutcome" TEXT NOT NULL,
    "bodySample" JSONB,
    "fieldPaths" JSONB,
    "shapeHash" TEXT,
    "errorMessage" TEXT,
    "diff" JSONB,
    "adapted" BOOLEAN NOT NULL DEFAULT false,
    "incidentId" UUID,
    "triggeredBy" TEXT NOT NULL DEFAULT 'scheduler',

    CONSTRAINT "monitor_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_baselines" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MonitorBaselineStatus" NOT NULL DEFAULT 'PENDING',
    "checkId" UUID,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "snapshot" JSONB NOT NULL,
    "fieldPaths" JSONB NOT NULL,
    "shapeHash" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_incidents" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "baselineId" UUID,
    "checkId" UUID,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "MonitorIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "previousResponse" JSONB,
    "latestResponse" JSONB,
    "diffs" JSONB NOT NULL DEFAULT '[]',
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "assignee" TEXT,
    "statusChangedBy" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_mappings" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "jsonPath" TEXT NOT NULL,
    "route" TEXT,
    "impactLevel" TEXT NOT NULL DEFAULT 'High',
    "description" TEXT,
    "symptom" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_proposals" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "status" "RecoveryProposalStatus" NOT NULL DEFAULT 'PENDING',
    "proposedSolution" TEXT NOT NULL,
    "transform" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT false,
    "targetEnvironment" TEXT NOT NULL DEFAULT 'Staging',
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "approver" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "promotedBy" TEXT,
    "promotedAt" TIMESTAMP(3),
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "monitors_status_nextRunAt_idx" ON "monitors"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "monitor_checks_monitorId_checkedAt_idx" ON "monitor_checks"("monitorId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "monitor_baselines_monitorId_status_idx" ON "monitor_baselines"("monitorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_baselines_monitorId_version_key" ON "monitor_baselines"("monitorId", "version");

-- CreateIndex
CREATE INDEX "monitor_incidents_monitorId_status_detectedAt_idx" ON "monitor_incidents"("monitorId", "status", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "monitor_incidents_fingerprint_status_idx" ON "monitor_incidents"("fingerprint", "status");

-- CreateIndex
CREATE INDEX "feature_mappings_monitorId_idx" ON "feature_mappings"("monitorId");

-- CreateIndex
CREATE INDEX "recovery_proposals_incidentId_idx" ON "recovery_proposals"("incidentId");

-- CreateIndex
CREATE INDEX "recovery_proposals_monitorId_status_idx" ON "recovery_proposals"("monitorId", "status");

-- AddForeignKey
ALTER TABLE "monitor_checks" ADD CONSTRAINT "monitor_checks_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_baselines" ADD CONSTRAINT "monitor_baselines_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_incidents" ADD CONSTRAINT "monitor_incidents_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_mappings" ADD CONSTRAINT "feature_mappings_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_proposals" ADD CONSTRAINT "recovery_proposals_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "monitor_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_proposals" ADD CONSTRAINT "recovery_proposals_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
