-- CreateEnum
CREATE TYPE "DetectionKind" AS ENUM ('STRUCTURAL', 'STATISTICAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BaselineStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "BaselineStatus" ADD VALUE 'APPROVED';
ALTER TYPE "BaselineStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "FindingStatus" ADD VALUE 'FALSE_POSITIVE';

-- AlterTable
ALTER TABLE "baselines" ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "contextKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "createdBy" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "endpointKey" TEXT,
ADD COLUMN     "promotedBy" TEXT,
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "windowFrom" TIMESTAMP(3),
ADD COLUMN     "windowTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "endpointKey" TEXT,
ADD COLUMN     "kind" "DetectionKind" NOT NULL DEFAULT 'STRUCTURAL',
ADD COLUMN     "observationIds" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "rule" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedBy" TEXT,
ADD COLUMN     "statusNote" TEXT;

-- CreateIndex
CREATE INDEX "baselines_providerKey_endpointKey_contextKey_status_idx" ON "baselines"("providerKey", "endpointKey", "contextKey", "status");

-- CreateIndex
CREATE INDEX "findings_providerKey_endpointKey_status_idx" ON "findings"("providerKey", "endpointKey", "status");

-- CreateIndex
CREATE INDEX "findings_rule_idx" ON "findings"("rule");

-- CreateIndex
CREATE INDEX "findings_lastSeenAt_idx" ON "findings"("lastSeenAt" DESC);
