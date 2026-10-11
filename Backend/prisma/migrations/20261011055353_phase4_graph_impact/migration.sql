-- CreateEnum
CREATE TYPE "EdgeProvenance" AS ENUM ('OBSERVED', 'MANUAL', 'INFERRED');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'IMPACT_REPORT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EdgeRelation" ADD VALUE 'NORMALIZES';
ALTER TYPE "EdgeRelation" ADD VALUE 'USES';
ALTER TYPE "EdgeRelation" ADD VALUE 'FEEDS_INTO';
ALTER TYPE "EdgeRelation" ADD VALUE 'COVERED_BY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NodeKind" ADD VALUE 'ADAPTER';
ALTER TYPE "NodeKind" ADD VALUE 'SERVICE';
ALTER TYPE "NodeKind" ADD VALUE 'TEST';

-- AlterTable
ALTER TABLE "dependency_edges" ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "consumedFields" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "provenance" "EdgeProvenance" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "impact_reports" (
    "id" UUID NOT NULL,
    "findingId" UUID,
    "nodeId" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "dependentCount" INTEGER NOT NULL,
    "testCount" INTEGER NOT NULL,
    "maxLikelihood" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impact_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impact_reports_findingId_createdAt_idx" ON "impact_reports"("findingId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "impact_reports_nodeId_createdAt_idx" ON "impact_reports"("nodeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "dependency_edges_provenance_idx" ON "dependency_edges"("provenance");

-- AddForeignKey
ALTER TABLE "impact_reports" ADD CONSTRAINT "impact_reports_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
