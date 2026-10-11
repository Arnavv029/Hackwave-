import { z } from 'zod';
import type { BaselineStatus } from '../generated/prisma/client.js';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../errors.js';
import type { Logger } from '../logger.js';
import { getEndpointContract, endpointKey as toEndpointKey, providerContracts, providerKeySchema, type ProviderKey } from '../providers/contracts.js';
import type { ObservationStore, StoredObservation } from '../observation/store.js';
import { correlationIdSchema } from '../observation/schemas.js';
import { detectionConfigInputSchema, resolveDetectionConfig } from './config.js';
import { compareSummaries, type BaselineComparison } from './compare.js';
import { buildBaselineSummary, InsufficientSamplesError } from './summary.js';
import type { BaselineListFilter, BaselineRecord, BaselineStore } from './stores.js';

/**
 * Baseline lifecycle. Baselines are created ONLY by an explicit request over
 * an explicit observation window; nothing promotes the first observation to
 * "expected". Transitions:
 *
 *   DRAFT -> PENDING_REVIEW -> APPROVED -> ACTIVE -> SUPERSEDED
 *   DRAFT | PENDING_REVIEW -> REJECTED
 *
 * Summary and config are immutable; only status/review columns change.
 */

export const actorSchema = z.string().min(1).max(128);

export const createBaselineSchema = z
  .object({
    provider: providerKeySchema,
    /** Endpoint name from the contract (`createCharge`) or endpoint key (`POST /charges`). */
    endpoint: z.string().min(1).max(256),
    /** Request-context discriminator; defaults to "" (any context). */
    contextKey: z.string().max(128).default(''),
    /** Observation window; defaults to the most recent `maxSamples`. */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    maxSamples: z.number().int().min(1).max(1_000).default(200),
    /** Restrict to a test run. */
    correlationId: correlationIdSchema.optional(),
    config: detectionConfigInputSchema.optional(),
    createdBy: actorSchema.default('system'),
    note: z.string().max(500).optional(),
  })
  .strict();
export type CreateBaselineInput = z.infer<typeof createBaselineSchema>;

export const reviewBaselineSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reviewer: actorSchema, note: z.string().max(1_000).optional() })
  .strict();

export const listBaselinesQuerySchema = z
  .object({
    provider: providerKeySchema.optional(),
    endpoint: z.string().min(1).max(256).optional(),
    status: z.enum(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUPERSEDED']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const ALLOWED: Record<BaselineStatus, BaselineStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'REJECTED'],
  PENDING_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['ACTIVE'],
  REJECTED: [],
  ACTIVE: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export interface BaselineServiceDeps {
  baselines: BaselineStore;
  observations: ObservationStore;
  logger: Logger;
  now?: () => Date;
}

export class BaselineService {
  private readonly now: () => Date;
  constructor(private readonly deps: BaselineServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  resolveEndpointKey(provider: ProviderKey, endpoint: string): { endpointKey: string; method: string } {
    const byName = getEndpointContract(provider, endpoint);
    if (byName) return { endpointKey: toEndpointKey(byName), method: byName.method };
    const [method, path] = endpoint.split(' ', 2);
    if (method && path && getEndpointContractByKey(provider, endpoint)) return { endpointKey: endpoint, method };
    throw new NotFoundError(`Unknown endpoint "${endpoint}" for provider "${provider}"`);
  }

  async createDraft(input: CreateBaselineInput): Promise<BaselineRecord> {
    const { endpointKey, method } = this.resolveEndpointKey(input.provider, input.endpoint);
    const config = resolveDetectionConfig(input.config);
    const page = await this.deps.observations.list({
      provider: input.provider,
      endpoint: endpointKey,
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      sort: 'desc',
      limit: Math.min(input.maxSamples, 200),
      offset: 0,
    });
    const observations: StoredObservation[] = page.rows.filter((o) => contextKeyOf(o) === input.contextKey || input.contextKey === '');
    let summary;
    try {
      summary = buildBaselineSummary({ providerKey: input.provider, endpointKey, method, contextKey: input.contextKey, observations, config });
    } catch (err) {
      if (err instanceof InsufficientSamplesError) {
        throw new UnprocessableError(err.message, { have: err.have, need: err.need, hint: 'record more observations or lower config.minSamplesForBaseline' });
      }
      throw err;
    }
    let record: BaselineRecord;
    try {
      record = await this.deps.baselines.create(
        {
          providerKey: input.provider,
          endpointKey,
          contextKey: input.contextKey,
          summary,
          config,
          windowFrom: new Date(summary.window.from),
          windowTo: new Date(summary.window.to),
          createdBy: input.createdBy,
          builtFrom: input.correlationId ? `observations:${input.correlationId}` : 'observations',
        },
        { action: 'baseline.drafted', actor: input.createdBy, details: { sampleCount: summary.sampleCount, note: input.note ?? null } },
      );
    } catch (err) {
      if (err instanceof Error && /no OPERATION node/.test(err.message)) throw new UnprocessableError(err.message);
      throw err;
    }
    this.deps.logger.info({ baselineId: record.id, version: record.version, provider: input.provider, endpoint: endpointKey, samples: summary.sampleCount }, 'baseline drafted');
    return record;
  }

  async get(id: string): Promise<BaselineRecord> {
    const record = await this.deps.baselines.findById(id);
    if (!record) throw new NotFoundError('Baseline not found');
    return record;
  }

  list(filter: BaselineListFilter): Promise<{ rows: BaselineRecord[]; total: number }> {
    return this.deps.baselines.list(filter);
  }

  async submitForReview(id: string, actor: string): Promise<BaselineRecord> {
    const b = await this.get(id);
    this.assertTransition(b, 'PENDING_REVIEW');
    return this.deps.baselines.transition(id, { status: 'PENDING_REVIEW' }, { action: 'baseline.submitted', actor });
  }

  async review(id: string, decision: 'approve' | 'reject', reviewer: string, note?: string): Promise<BaselineRecord> {
    const b = await this.get(id);
    const target: BaselineStatus = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    this.assertTransition(b, target);
    if (decision === 'approve' && b.createdBy === reviewer && b.createdBy !== 'system') {
      throw new ValidationError('A baseline cannot be approved by the actor who created it', { createdBy: b.createdBy });
    }
    const now = this.now();
    return this.deps.baselines.transition(
      id,
      { status: target, reviewedBy: reviewer, reviewedAt: now, reviewNote: note ?? null },
      { action: decision === 'approve' ? 'baseline.approved' : 'baseline.rejected', actor: reviewer, details: { note: note ?? null } },
    );
  }

  async promote(id: string, actor: string): Promise<BaselineRecord> {
    const b = await this.get(id);
    this.assertTransition(b, 'ACTIVE');
    const promoted = await this.deps.baselines.promote(id, actor, this.now());
    this.deps.logger.info({ baselineId: id, version: promoted.version, provider: promoted.providerKey, endpoint: promoted.endpointKey }, 'baseline promoted');
    return promoted;
  }

  async compare(fromId: string, toId: string): Promise<BaselineComparison> {
    const [a, b] = await Promise.all([this.get(fromId), this.get(toId)]);
    if (a.providerKey !== b.providerKey || a.endpointKey !== b.endpointKey) {
      throw new ValidationError('Baselines belong to different endpoints', { from: `${a.providerKey} ${a.endpointKey}`, to: `${b.providerKey} ${b.endpointKey}` });
    }
    return compareSummaries(a, b);
  }

  private assertTransition(b: BaselineRecord, target: BaselineStatus): void {
    if (!ALLOWED[b.status].includes(target)) {
      throw new ConflictError(`Baseline v${b.version} is ${b.status}; cannot move to ${target}`, { from: b.status, allowed: ALLOWED[b.status] });
    }
  }
}

function getEndpointContractByKey(provider: ProviderKey, key: string): boolean {
  return Object.values(providerContracts[provider].endpoints).some((e) => toEndpointKey(e) === key);
}

/** Request context used to pick a baseline: sorted query keys, or "" when none. */
export function contextKeyOf(o: StoredObservation): string {
  const keys = o.requestMeta.queryKeys;
  return keys.length ? `query:${[...keys].sort().join(',')}` : '';
}
