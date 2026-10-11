-- CreateEnum
CREATE TYPE "NodeKind" AS ENUM ('PROVIDER', 'OPERATION', 'CLIENT', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EdgeRelation" AS ENUM ('EXPOSES', 'CALLS', 'CONSUMES');

-- CreateEnum
CREATE TYPE "ObservationSource" AS ENUM ('PROBE', 'PROXY', 'MANUAL', 'SEED');

-- CreateEnum
CREATE TYPE "ObservationOutcome" AS ENUM ('SUCCESS', 'HTTP_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "BaselineStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('STRUCTURAL', 'BEHAVIORAL', 'RATE_LIMIT', 'AVAILABILITY', 'PAGINATION', 'SEMANTIC', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'REPAIR_PROPOSED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RepairKind" AS ENUM ('FIELD_MAPPING', 'RETRY_POLICY', 'PAGINATION_ADAPTER', 'CIRCUIT_BREAKER', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'VALIDATING', 'VALIDATED', 'BLOCKED', 'ACTIVE', 'ROLLED_BACK', 'REJECTED');

-- CreateEnum
CREATE TYPE "RepairVersionStatus" AS ENUM ('CANDIDATE', 'VALIDATED', 'ACTIVE', 'FAILED', 'SUPERSEDED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'USER', 'SERVICE');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('DEPENDENCY_NODE', 'DEPENDENCY_EDGE', 'OBSERVATION', 'BASELINE', 'FINDING', 'REPAIR_PROPOSAL', 'REPAIR_VERSION', 'TEST_RUN');

-- CreateTable
CREATE TABLE "dependency_nodes" (
    "id" UUID NOT NULL,
    "kind" "NodeKind" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIUM',
    "baseUrl" TEXT,
    "secretRef" TEXT,
    "method" TEXT,
    "path" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dependency_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependency_edges" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "relation" "EdgeRelation" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dependency_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "source" "ObservationSource" NOT NULL DEFAULT 'PROBE',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "ObservationOutcome" NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "requestShape" JSONB,
    "responseShape" JSONB,
    "responseSample" JSONB,
    "headers" JSONB,
    "errorMessage" TEXT,
    "shapeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baselines" (
    "id" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BaselineStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" JSONB NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "builtFrom" TEXT NOT NULL DEFAULT 'observations',
    "activatedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "baselineId" UUID NOT NULL,
    "observationId" UUID,
    "category" "FindingCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "confidence" DOUBLE PRECISION NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_proposals" (
    "id" UUID NOT NULL,
    "findingId" UUID NOT NULL,
    "kind" "RepairKind" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "risk" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "rationale" TEXT NOT NULL,
    "preconditions" JSONB NOT NULL DEFAULT '[]',
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "blockedReason" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_versions" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RepairVersionStatus" NOT NULL DEFAULT 'CANDIDATE',
    "spec" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" UUID NOT NULL,
    "repairVersionId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "status" "TestRunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggeredBy" TEXT NOT NULL DEFAULT 'system',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "results" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dependency_nodes_key_key" ON "dependency_nodes"("key");

-- CreateIndex
CREATE INDEX "dependency_nodes_kind_idx" ON "dependency_nodes"("kind");

-- CreateIndex
CREATE INDEX "dependency_nodes_parentId_idx" ON "dependency_nodes"("parentId");

-- CreateIndex
CREATE INDEX "dependency_nodes_kind_enabled_idx" ON "dependency_nodes"("kind", "enabled");

-- CreateIndex
CREATE INDEX "dependency_edges_targetId_idx" ON "dependency_edges"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "dependency_edges_sourceId_targetId_relation_key" ON "dependency_edges"("sourceId", "targetId", "relation");

-- CreateIndex
CREATE INDEX "observations_nodeId_observedAt_idx" ON "observations"("nodeId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "observations_nodeId_outcome_idx" ON "observations"("nodeId", "outcome");

-- CreateIndex
CREATE INDEX "observations_shapeHash_idx" ON "observations"("shapeHash");

-- CreateIndex
CREATE INDEX "baselines_nodeId_status_idx" ON "baselines"("nodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "baselines_nodeId_version_key" ON "baselines"("nodeId", "version");

-- CreateIndex
CREATE INDEX "findings_nodeId_status_idx" ON "findings"("nodeId", "status");

-- CreateIndex
CREATE INDEX "findings_status_severity_idx" ON "findings"("status", "severity");

-- CreateIndex
CREATE INDEX "findings_category_idx" ON "findings"("category");

-- CreateIndex
CREATE UNIQUE INDEX "findings_baselineId_fingerprint_key" ON "findings"("baselineId", "fingerprint");

-- CreateIndex
CREATE INDEX "repair_proposals_findingId_status_idx" ON "repair_proposals"("findingId", "status");

-- CreateIndex
CREATE INDEX "repair_proposals_status_idx" ON "repair_proposals"("status");

-- CreateIndex
CREATE INDEX "repair_versions_proposalId_status_idx" ON "repair_versions"("proposalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repair_versions_proposalId_version_key" ON "repair_versions"("proposalId", "version");

-- CreateIndex
CREATE INDEX "test_runs_repairVersionId_status_idx" ON "test_runs"("repairVersionId", "status");

-- CreateIndex
CREATE INDEX "test_runs_workflowId_createdAt_idx" ON "test_runs"("workflowId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_events_correlationId_idx" ON "audit_events"("correlationId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "dependency_nodes" ADD CONSTRAINT "dependency_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency_edges" ADD CONSTRAINT "dependency_edges_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependency_edges" ADD CONSTRAINT "dependency_edges_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_proposals" ADD CONSTRAINT "repair_proposals_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_versions" ADD CONSTRAINT "repair_versions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "repair_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_repairVersionId_fkey" FOREIGN KEY ("repairVersionId") REFERENCES "repair_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "dependency_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
