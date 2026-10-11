import { z } from 'zod';
import type { FindingStatus } from '../generated/prisma/client.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { Logger } from '../logger.js';
import { providerKeySchema } from '../providers/contracts.js';
import type { ObservationStore, StoredObservation } from '../observation/store.js';
import { contextKeyOf } from './baseline-service.js';
import { runRules, type RuleFinding } from './rules.js';
import type { BaselineRecord, BaselineStore, FindingListFilter, FindingRecord, FindingStore } from './stores.js';

/**
 * Compares a freshly stored observation with the ACTIVE baseline for its
 * endpoint and context, runs the deterministic rules, and persists findings
 * with deduplication and lifecycle handling. Never mutates baselines.
 */

export interface DetectionOutcome {
  evaluated: boolean;
  reason?: string;
  baseline?: { id: string; version: number };
  findings: FindingRecord[];
  /** Findings that matched a FALSE_POSITIVE record and were suppressed. */
  suppressed: number;
}

export interface DetectionServiceDeps {
  baselines: BaselineStore;
  findings: FindingStore;
  observations: ObservationStore;
  logger: Logger;
}

export class DetectionService {
  constructor(private readonly deps: DetectionServiceDeps) {}

  async evaluate(observation: StoredObservation): Promise<DetectionOutcome> {
    const contextKey = contextKeyOf(observation);
    const baseline =
      (await this.deps.baselines.findActive(observation.providerKey, observation.endpointKey, contextKey)) ??
      (contextKey ? await this.deps.baselines.findActive(observation.providerKey, observation.endpointKey, '') : null);
    if (!baseline) return { evaluated: false, reason: 'no ACTIVE baseline for this endpoint', findings: [], suppressed: 0 };

    const window = await this.loadWindow(observation, baseline);
    const results = runRules({ observation, baseline: baseline.summary, window, config: baseline.config });
    const findings: FindingRecord[] = [];
    let suppressed = 0;
    for (const r of results) {
      const persisted = await this.persist(r, observation, baseline);
      if (persisted) findings.push(persisted);
      else suppressed += 1;
    }
    this.deps.logger.info(
      { observationId: observation.id, baselineId: baseline.id, baselineVersion: baseline.version, findings: findings.map((f) => `${f.rule}:${f.severity}`), suppressed },
      'observation evaluated',
    );
    return { evaluated: true, baseline: { id: baseline.id, version: baseline.version }, findings, suppressed };
  }

  private async loadWindow(observation: StoredObservation, baseline: BaselineRecord): Promise<StoredObservation[]> {
    const page = await this.deps.observations.list({
      provider: observation.providerKey,
      endpoint: observation.endpointKey,
      sort: 'desc',
      limit: baseline.config.window.size,
      offset: 0,
    });
    // Only observations newer than the baseline window count as "recent".
    const windowEnd = baseline.windowTo.getTime();
    const rows = page.rows.filter((o) => o.observedAt.getTime() > windowEnd || o.id === observation.id);
    if (!rows.some((o) => o.id === observation.id)) rows.unshift(observation);
    return rows;
  }

  private async persist(r: RuleFinding, observation: StoredObservation, baseline: BaselineRecord): Promise<FindingRecord | null> {
    const existing = await this.deps.findings.findByFingerprint(baseline.id, r.fingerprint);
    if (!existing) {
      return this.deps.findings.create({
        nodeId: observation.nodeId,
        baselineId: baseline.id,
        observationId: observation.id,
        providerKey: observation.providerKey,
        endpointKey: observation.endpointKey,
        rule: r.rule,
        kind: r.kind,
        category: r.category,
        severity: r.severity,
        confidence: r.confidence,
        fingerprint: r.fingerprint,
        summary: r.summary,
        evidence: { ...r.evidence, baselineVersion: baseline.version },
        seenAt: observation.observedAt,
      });
    }
    const update = {
      severity: r.severity,
      confidence: r.confidence,
      summary: r.summary,
      evidence: { ...r.evidence, baselineVersion: baseline.version },
      observationId: observation.id,
      seenAt: observation.observedAt,
      reopen: existing.status === 'RESOLVED',
    };
    const updated = await this.deps.findings.recordRecurrence(existing.id, update);
    // FALSE_POSITIVE and DISMISSED stay suppressed (still counted for the audit trail).
    return updated.status === 'FALSE_POSITIVE' || updated.status === 'DISMISSED' ? null : updated;
  }
}

// ---------------------------------------------------------------------------
// Finding lifecycle
// ---------------------------------------------------------------------------

export const findingStatusChangeSchema = z
  .object({
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE']),
    actor: z.string().min(1).max(128),
    note: z.string().max(1_000).optional(),
  })
  .strict();

export const listFindingsQuerySchema = z
  .object({
    provider: providerKeySchema.optional(),
    endpoint: z.string().min(1).max(256).optional(),
    status: z.enum(['OPEN', 'ACKNOWLEDGED', 'REPAIR_PROPOSED', 'RESOLVED', 'DISMISSED', 'FALSE_POSITIVE']).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    category: z.enum(['STRUCTURAL', 'BEHAVIORAL', 'RATE_LIMIT', 'AVAILABILITY', 'PAGINATION', 'SEMANTIC', 'OPERATIONAL']).optional(),
    kind: z.enum(['STRUCTURAL', 'STATISTICAL']).optional(),
    rule: z.string().min(1).max(64).optional(),
    baselineId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'],
  ACKNOWLEDGED: ['OPEN', 'RESOLVED', 'FALSE_POSITIVE'],
  RESOLVED: ['OPEN'],
  FALSE_POSITIVE: ['OPEN'],
  DISMISSED: ['OPEN'],
  REPAIR_PROPOSED: ['OPEN', 'RESOLVED'],
};

export class FindingService {
  constructor(private readonly findings: FindingStore) {}

  async get(id: string): Promise<FindingRecord> {
    const f = await this.findings.findById(id);
    if (!f) throw new NotFoundError('Finding not found');
    return f;
  }

  list(filter: FindingListFilter): Promise<{ rows: FindingRecord[]; total: number }> {
    return this.findings.list(filter);
  }

  async changeStatus(id: string, input: z.infer<typeof findingStatusChangeSchema>, now = new Date()): Promise<FindingRecord> {
    const f = await this.get(id);
    if (!FINDING_TRANSITIONS[f.status].includes(input.status)) {
      throw new ConflictError(`Finding is ${f.status}; cannot move to ${input.status}`, { from: f.status, allowed: FINDING_TRANSITIONS[f.status] });
    }
    return this.findings.setStatus(
      id,
      { status: input.status, actor: input.actor, ...(input.note !== undefined ? { note: input.note } : {}), now },
      { action: `finding.${input.status.toLowerCase()}`, actor: input.actor, details: { from: f.status, note: input.note ?? null } },
    );
  }
}
