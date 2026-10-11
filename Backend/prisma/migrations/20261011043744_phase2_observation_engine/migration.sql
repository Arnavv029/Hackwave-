-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('HTTP_ERROR', 'RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT', 'CONNECTION_ERROR', 'MALFORMED_JSON', 'RESPONSE_TOO_LARGE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ParseOutcome" AS ENUM ('JSON', 'EMPTY', 'NON_JSON', 'MALFORMED_JSON', 'TRUNCATED', 'NOT_READ');

-- AlterEnum
ALTER TYPE "ObservationOutcome" ADD VALUE 'MALFORMED_RESPONSE';

-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "contractCheck" JSONB,
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "endpointKey" TEXT,
ADD COLUMN     "errorCategory" "ErrorCategory",
ADD COLUMN     "fieldPaths" JSONB,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "parseOutcome" "ParseOutcome",
ADD COLUMN     "providerKey" TEXT,
ADD COLUMN     "requestMeta" JSONB,
ADD COLUMN     "responseBytes" INTEGER,
ADD COLUMN     "scenario" TEXT,
ADD COLUMN     "shapeDelta" JSONB;

-- CreateIndex
CREATE INDEX "observations_providerKey_endpointKey_observedAt_idx" ON "observations"("providerKey", "endpointKey", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "observations_observedAt_idx" ON "observations"("observedAt" DESC);

-- CreateIndex
CREATE INDEX "observations_statusCode_idx" ON "observations"("statusCode");

-- CreateIndex
CREATE INDEX "observations_errorCategory_idx" ON "observations"("errorCategory");

-- CreateIndex
CREATE INDEX "observations_correlationId_idx" ON "observations"("correlationId");
