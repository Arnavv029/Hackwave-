import type {
  Finding,
  FindingCategory,
  FindingStatus,
  Severity,
} from '../../generated/prisma/client.js';
import { clampPage, type DbClient, type JsonInput, type PageOptions } from '../types.js';

export interface RecordFindingInput {
  nodeId: string;
  baselineId: string;
  observationId?: string;
  category: FindingCategory;
  severity: Severity;
  confidence: number;
  fingerprint: string;
  summary: string;
  evidence: JsonInput;
  seenAt?: Date;
}

export interface ListFindingsFilter extends PageOptions {
  nodeId?: string;
  status?: FindingStatus | FindingStatus[];
  category?: FindingCategory;
  severity?: Severity;
}

export class FindingRepository {
  constructor(private readonly db: DbClient) {}

  /**
   * Record a finding. The same drift observed again against the same baseline
   * (same fingerprint) bumps `occurrenceCount`/`lastSeenAt` instead of
   * creating a duplicate.
   */
  record(input: RecordFindingInput): Promise<Finding> {
    const { seenAt = new Date(), fingerprint, baselineId, ...rest } = input;
    return this.db.finding.upsert({
      where: { baselineId_fingerprint: { baselineId, fingerprint } },
      create: { ...rest, baselineId, fingerprint, firstSeenAt: seenAt, lastSeenAt: seenAt },
      update: {
        lastSeenAt: seenAt,
        occurrenceCount: { increment: 1 },
        severity: rest.severity,
        confidence: rest.confidence,
        evidence: rest.evidence,
      },
    });
  }

  findById(id: string): Promise<Finding | null> {
    return this.db.finding.findUnique({ where: { id } });
  }

  list(filter: ListFindingsFilter = {}): Promise<Finding[]> {
    const { take, skip } = clampPage(filter);
    return this.db.finding.findMany({
      where: {
        ...(filter.nodeId !== undefined ? { nodeId: filter.nodeId } : {}),
        ...(filter.status !== undefined
          ? { status: Array.isArray(filter.status) ? { in: filter.status } : filter.status }
          : {}),
        ...(filter.category !== undefined ? { category: filter.category } : {}),
        ...(filter.severity !== undefined ? { severity: filter.severity } : {}),
      },
      orderBy: [{ lastSeenAt: 'desc' }],
      take,
      skip,
    });
  }

  setStatus(id: string, status: FindingStatus, now: Date = new Date()): Promise<Finding> {
    const resolved = status === 'RESOLVED' || status === 'DISMISSED';
    return this.db.finding.update({
      where: { id },
      data: { status, resolvedAt: resolved ? now : null },
    });
  }
}
