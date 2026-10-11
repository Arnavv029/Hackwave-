import { ConflictError, NotFoundError, ServiceUnavailableError, TooManyRequestsError, UnprocessableError, ValidationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { BaselineStore, FindingRecord, FindingStore } from '../detection/stores.js';
import type { ImpactReportStore } from '../graph/stores.js';
import type { ImpactReportBody } from '../graph/service.js';
import type { ObservationStore, StoredObservation } from '../observation/store.js';
import { ADAPTERS, adaptersForEndpoint, type AdapterEndpointDefinition } from '../repair/adapters.js';
import { normalize } from '../repair/engine.js';
import { matchRules } from '../repair/matcher.js';
import type { RepairRuleSpec } from '../repair/schemas.js';
import type { RuleStore } from '../repair/stores.js';
import type { RepairService } from '../repair/service.js';
import { buildChangeReport, buildUserPrompt, ChangeReportTooLargeError, SYSTEM_PROMPT, type BuiltChangeReport } from './change-report.js';
import { compileProposal, type PolicyIssue } from './policy.js';
import { ProviderFailure, type AiProposalProvider, type ProposalResponse } from './provider.js';
import { aiProposalOutputSchema, type AiProposalOutput } from './schemas.js';
import type { AiProposalRecord, AiProposalStore } from './stores.js';
import type { AiProposalStatus, RiskLevel } from '../generated/prisma/client.js';

/**
 * AI-assisted proposal service. The provider proposes; this service builds
 * the input, enforces limits, validates and polices the output, runs the
 * compiled transform through the deterministic engine, and persists the
 * result with a backend-decided status. Nothing here applies a repair.
 */

export interface AiServiceLimits {
  timeoutMs: number;
  maxRetries: number;
  maxRequestsPerMinute: number;
  maxConcurrent: number;
  maxReportBytes: number;
  maxOutputTokens: number;
}

export interface AiRepairServiceDeps {
  provider: AiProposalProvider | null;
  store: AiProposalStore;
  findings: FindingStore;
  baselines: BaselineStore;
  observations: ObservationStore;
  impactReports: ImpactReportStore;
  rules: RuleStore;
  repairs: RepairService;
  logger: Logger;
  limits: AiServiceLimits;
  /** Injectable clock / sleep for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AiProposeResult {
  proposal: AiProposalRecord;
  report: { bytes: number; hash: string; warnings: string[] };
}

/** Simple sliding-window + concurrency limiter; per process by design. */
class RequestLimiter {
  private readonly stamps: number[] = [];
  private inFlight = 0;
  constructor(
    private readonly perMinute: number,
    private readonly maxConcurrent: number,
    private readonly now: () => number,
  ) {}
  acquire(): () => void {
    const t = this.now();
    while (this.stamps.length && t - (this.stamps[0] as number) > 60_000) this.stamps.shift();
    if (this.stamps.length >= this.perMinute) throw new TooManyRequestsError('AI proposal rate limit reached', { perMinute: this.perMinute, retryAfterSeconds: Math.ceil((60_000 - (t - (this.stamps[0] as number))) / 1000) });
    if (this.inFlight >= this.maxConcurrent) throw new TooManyRequestsError('Too many AI proposals in flight', { maxConcurrent: this.maxConcurrent });
    this.stamps.push(t);
    this.inFlight += 1;
    return () => {
      this.inFlight -= 1;
    };
  }
}

export class AiRepairService {
  private readonly limiter: RequestLimiter;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: AiRepairServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RequestLimiter(deps.limits.maxRequestsPerMinute, deps.limits.maxConcurrent, this.now);
  }

  get enabled(): boolean {
    return this.deps.provider !== null;
  }

  async propose(findingId: string, createdBy: string, impactReportId?: string): Promise<AiProposeResult> {
    const provider = this.deps.provider;
    if (!provider) throw new ServiceUnavailableError('AI proposals are disabled (AI_PROVIDER=disabled)');
    const finding = await this.deps.findings.findById(findingId);
    if (!finding) throw new NotFoundError('Finding not found');

    // Deterministic rules come first: the AI is only for unfamiliar changes.
    const approved = await this.deps.rules.listApproved();
    const matches = matchRules(finding, approved.map((r) => ({ spec: r.spec, version: r.version })));
    if (matches.length > 0) {
      throw new ConflictError('An approved deterministic rule already handles this finding; use POST /api/repairs/propose', { rules: matches.map((m) => `${m.rule.key} v${m.version}`) });
    }
    const adapters = adaptersForEndpoint(finding.providerKey, finding.endpointKey);
    const adapter = adapters[0];
    const endpoint = adapter?.endpoints[finding.endpointKey];
    if (!adapter || !endpoint) throw new UnprocessableError(`No adapter normalises ${finding.providerKey} ${finding.endpointKey}; nothing to repair`, { adapters: Object.keys(ADAPTERS) });

    const { newObs, oldObs, baseline, impact } = await this.gatherContext(finding, impactReportId);
    let built: BuiltChangeReport;
    try {
      built = buildChangeReport({ finding, baseline, newObservation: newObs, oldObservation: oldObs, impact, adapter, endpoint, maxBytes: this.deps.limits.maxReportBytes });
    } catch (err) {
      if (err instanceof ChangeReportTooLargeError) throw new UnprocessableError(err.message, { bytes: err.bytes, max: err.max });
      throw err;
    }
    const inputRefs = {
      newObservationId: newObs.id,
      oldObservationId: oldObs?.id ?? null,
      baselineId: baseline?.id ?? null,
      baselineVersion: baseline?.version ?? null,
      impactReportId: impact?.id ?? null,
      reportHash: built.hash,
      reportBytes: built.bytes,
      promptVersion: 1,
    };

    const release = this.limiter.acquire();
    const started = this.now();
    let response: ProposalResponse | null = null;
    let failure: ProviderFailure | null = null;
    let attempts = 0;
    try {
      const outcome = await this.callWithRetries(provider, built, (n) => (attempts = n));
      if (outcome instanceof ProviderFailure) failure = outcome;
      else response = outcome;
    } finally {
      release();
    }
    const latencyMs = Math.max(0, this.now() - started);

    if (failure || !response) {
      const f = failure ?? new ProviderFailure('UNKNOWN', 'no response', false);
      const rec = await this.deps.store.create(
        { findingId, status: 'PROVIDER_ERROR', provider: provider.name, model: provider.model, requestId: null, usage: null, latencyMs, attempts, inputRefs, proposal: null, compiledTransform: null, policyIssues: [], validation: null, risk: 'HIGH', requiresHumanReview: true, errorCategory: f.category, errorMessage: f.message, createdBy },
        { action: 'ai_proposal.provider_error', actor: createdBy, details: { findingId, category: f.category, attempts } },
      );
      this.deps.logger.warn({ aiProposalId: rec.id, findingId, category: f.category, attempts, latencyMs }, 'ai proposal: provider error');
      return { proposal: rec, report: { bytes: built.bytes, hash: built.hash, warnings: built.report.warnings } };
    }

    // 1. Shape validation (independent of what the provider's parser did).
    const parsed = aiProposalOutputSchema.safeParse(response.output);
    if (!parsed.success) {
      const issues: PolicyIssue[] = parsed.error.issues.slice(0, 20).map((i) => ({ code: 'UNSUPPORTED_TRANSFORM', path: i.path.map(String).join('.') || '(root)', message: i.message.slice(0, 200) }));
      const rec = await this.persist(findingId, createdBy, provider, response, latencyMs, attempts, inputRefs, null, null, issues, null, 'REJECTED_BY_POLICY', 'HIGH', built, 'output did not match the proposal schema');
      return { proposal: rec, report: { bytes: built.bytes, hash: built.hash, warnings: built.report.warnings } };
    }
    const output = parsed.data;

    // 2. Policy: forbidden content, supported transform, contract fields.
    const compiled = compileProposal(output, endpoint);
    if (compiled.issues.length > 0) {
      const rec = await this.persist(findingId, createdBy, provider, response, latencyMs, attempts, inputRefs, output, null, compiled.issues, null, 'REJECTED_BY_POLICY', 'HIGH', built, `${compiled.issues.length} policy issue(s)`);
      return { proposal: rec, report: { bytes: built.bytes, hash: built.hash, warnings: built.report.warnings } };
    }
    if (!compiled.transform) {
      const rec = await this.persist(findingId, createdBy, provider, response, latencyMs, attempts, inputRefs, output, null, [], null, 'NEEDS_INFORMATION', 'HIGH', built, 'model proposed no transformation');
      return { proposal: rec, report: { bytes: built.bytes, hash: built.hash, warnings: built.report.warnings } };
    }

    // 3. Backend validation through the deterministic engine, never through the model.
    const validation = this.validateTransform(endpoint, compiled.transform, newObs, oldObs);
    const status: AiProposalStatus = validation.ok ? 'PENDING_REVIEW' : 'FAILED_VALIDATION';
    const risk = assessRisk(output, impact?.report ?? null, built.report.warnings);
    const rec = await this.persist(findingId, createdBy, provider, response, latencyMs, attempts, inputRefs, output, compiled.transform, [], validation, status, risk, built, null);
    return { proposal: rec, report: { bytes: built.bytes, hash: built.hash, warnings: built.report.warnings } };
  }

  private async callWithRetries(provider: AiProposalProvider, built: BuiltChangeReport, onAttempt: (n: number) => void): Promise<ProposalResponse | ProviderFailure> {
    const { timeoutMs, maxRetries, maxOutputTokens } = this.deps.limits;
    let last: ProviderFailure | null = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      onAttempt(attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await provider.propose({ report: built.report, systemPrompt: SYSTEM_PROMPT, userPrompt: buildUserPrompt(built.report), timeoutMs, maxOutputTokens, signal: controller.signal });
        clearTimeout(timer);
        return response;
      } catch (err) {
        clearTimeout(timer);
        const f = err instanceof ProviderFailure ? err : new ProviderFailure('UNKNOWN', err instanceof Error ? err.message : String(err), false);
        last = controller.signal.aborted && f.category !== 'TIMEOUT' ? new ProviderFailure('TIMEOUT', `provider exceeded ${timeoutMs}ms`, true) : f;
        this.deps.logger.warn({ attempt, category: last.category, retryable: last.retryable }, 'ai provider call failed');
        if (!last.retryable || attempt > maxRetries) break;
        await this.sleep(Math.min(8_000, 250 * 2 ** (attempt - 1)));
      }
    }
    return last ?? new ProviderFailure('UNKNOWN', 'no attempts made', false);
  }

  private validateTransform(endpoint: AdapterEndpointDefinition, transform: NonNullable<ReturnType<typeof compileProposal>['transform']>, newObs: StoredObservation, oldObs: StoredObservation | null): Record<string, unknown> & { ok: boolean } {
    const policy = { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false } as const;
    const run = (payload: unknown) => {
      const r = normalize({ definition: endpoint, payload, transforms: [transform], policy });
      return { ok: r.ok, rejections: r.rejections.slice(0, 10), outputHash: r.outputHash, droppedFields: r.droppedFields };
    };
    const base = (payload: unknown) => normalize({ definition: endpoint, payload, transforms: [], policy }).ok;
    const onNew = run(newObs.responseSample);
    const onOld = oldObs ? run(oldObs.responseSample) : null;
    const withoutRepairOnNew = base(newObs.responseSample);
    const ok = onNew.ok && (onOld === null || onOld.ok);
    return {
      ok,
      newSample: { observationId: newObs.id, ...onNew },
      oldSample: oldObs ? { observationId: oldObs.id, ...onOld } : null,
      baseAdapterAlreadyHandlesNewSample: withoutRepairOnNew,
      note: withoutRepairOnNew ? 'the base adapter already accepts the new sample; the proposal may be unnecessary' : ok ? 'compiled transform normalises the new sample and keeps the old one working' : 'compiled transform does not produce a valid internal record',
    };
  }

  private async persist(findingId: string, createdBy: string, provider: AiProposalProvider, response: ProposalResponse, latencyMs: number, attempts: number, inputRefs: Record<string, unknown>, output: AiProposalOutput | null, transform: AiProposalRecord['compiledTransform'], issues: PolicyIssue[], validation: Record<string, unknown> | null, status: AiProposalStatus, risk: RiskLevel, built: BuiltChangeReport, errorMessage: string | null): Promise<AiProposalRecord> {
    const rec = await this.deps.store.create(
      { findingId, status, provider: response.provider, model: response.model, requestId: response.requestId, usage: response.usage, latencyMs, attempts, inputRefs, proposal: output, compiledTransform: transform, policyIssues: issues, validation, risk, requiresHumanReview: true, errorCategory: null, errorMessage, createdBy },
      { action: `ai_proposal.${status.toLowerCase()}`, actor: createdBy, details: { findingId, provider: provider.name, model: response.model, reportHash: built.hash, issues: issues.map((i) => i.code), warnings: built.report.warnings.length } },
    );
    this.deps.logger.info({ aiProposalId: rec.id, findingId, status, risk, provider: provider.name, model: response.model, latencyMs, attempts, usage: response.usage, policyIssues: issues.length }, 'ai proposal recorded');
    return rec;
  }

  private async gatherContext(finding: FindingRecord, impactReportId?: string): Promise<{ newObs: StoredObservation; oldObs: StoredObservation | null; baseline: Awaited<ReturnType<BaselineStore['findById']>>; impact: { id: string; report: ImpactReportBody } | null }> {
    const newId = finding.observationIds.at(-1) ?? finding.observationId;
    const newObs = newId ? await this.deps.observations.findById(newId) : null;
    if (!newObs || newObs.responseSample === null || newObs.responseSample === undefined) throw new UnprocessableError('The finding has no observation with a response sample');
    const baseline = await this.deps.baselines.findById(finding.baselineId);
    let oldObs: StoredObservation | null = null;
    const lastBaselineObsId = baseline?.summary.window.lastObservationId;
    if (lastBaselineObsId) oldObs = await this.deps.observations.findById(lastBaselineObsId);
    if (!oldObs) {
      const page = await this.deps.observations.list({ provider: finding.providerKey, endpoint: finding.endpointKey, outcome: 'SUCCESS', ...(baseline ? { to: baseline.windowTo } : {}), sort: 'desc', limit: 1, offset: 0 });
      oldObs = page.rows[0] ?? null;
    }
    let impact: { id: string; report: ImpactReportBody } | null = null;
    if (impactReportId) {
      const r = await this.deps.impactReports.findById(impactReportId);
      if (!r) throw new NotFoundError('Impact report not found');
      if (r.findingId !== finding.id) throw new ValidationError('Impact report belongs to a different finding');
      impact = { id: r.id, report: r.report as unknown as ImpactReportBody };
    } else {
      const latest = (await this.deps.impactReports.listForFinding(finding.id, 1))[0];
      if (latest) impact = { id: latest.id, report: latest.report as unknown as ImpactReportBody };
    }
    return { newObs, oldObs, baseline, impact };
  }

  // --- lifecycle -----------------------------------------------------------

  async get(id: string): Promise<AiProposalRecord> {
    const r = await this.deps.store.findById(id);
    if (!r) throw new NotFoundError('AI proposal not found');
    return r;
  }

  list(filter: { findingId?: string; status?: AiProposalStatus; limit: number; offset: number }): Promise<{ rows: AiProposalRecord[]; total: number }> {
    return this.deps.store.list(filter);
  }

  /** A human turns a validated proposal into a DRAFT deterministic rule; Phase 5 approval and validation still apply. */
  async promoteToRule(id: string, actor: string, note?: string): Promise<{ proposal: AiProposalRecord; rule: { id: string; key: string; version: number; status: string } }> {
    const p = await this.get(id);
    if (p.status !== 'PENDING_REVIEW') throw new ConflictError(`AI proposal is ${p.status}; only PENDING_REVIEW proposals can be promoted`);
    if (!p.compiledTransform || !p.proposal) throw new ConflictError('AI proposal has no compiled transform');
    const finding = await this.deps.findings.findById(p.findingId);
    if (!finding) throw new NotFoundError('Finding not found');
    const adapter = adaptersForEndpoint(finding.providerKey, finding.endpointKey)[0];
    if (!adapter) throw new UnprocessableError('Adapter no longer exists');
    const newObs = typeof p.inputRefs['newObservationId'] === 'string' ? await this.deps.observations.findById(p.inputRefs['newObservationId']) : null;
    const oldObs = typeof p.inputRefs['oldObservationId'] === 'string' ? await this.deps.observations.findById(p.inputRefs['oldObservationId']) : null;
    const change = { path: typeof finding.evidence['path'] === 'string' ? finding.evidence['path'] : typeof finding.evidence['from'] === 'string' ? finding.evidence['from'] : undefined };
    const itemsPath = adapter.endpoints[finding.endpointKey]?.itemsPath;
    const strip = (s: string | undefined): string | undefined => {
      if (!s) return undefined;
      const plain = s.replace(/\[\]/g, '');
      return itemsPath && plain.startsWith(`${itemsPath}.`) ? plain.slice(itemsPath.length + 1) : plain;
    };
    const t = p.compiledTransform;
    const spec: RepairRuleSpec = {
      key: `ai.${finding.providerKey}.${finding.endpointKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${p.id.slice(0, 8)}`,
      title: `AI-proposed: ${p.proposal.summary.slice(0, 150)}`,
      description: `Promoted from AI proposal ${p.id} (${p.provider}/${p.model}). Assumptions: ${p.proposal.assumptions.join('; ') || 'none'}. Ambiguities: ${p.proposal.ambiguities.join('; ') || 'none'}. Unsafe reasons: ${p.proposal.unsafe_reasons.join('; ') || 'none'}.`.slice(0, 2_000),
      scope: { provider: finding.providerKey, endpointKey: finding.endpointKey, adapterKey: adapter.key },
      match: {
        findingRules: [finding.rule],
        ...(strip(change.path) ? { path: strip(change.path) } : {}),
        ...(t.type === 'rename_field' && finding.rule === 'structural.rename_candidate' ? { renamedTo: t.renamedTo } : {}),
        ...(t.type === 'enum_mapping' && Array.isArray(finding.evidence['after']) ? { values: (finding.evidence['after'] as unknown[]).filter((v): v is string => typeof v === 'string') } : {}),
      },
      transform: t,
      policy: { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false },
      risk: p.risk === 'LOW' ? 'MEDIUM' : p.risk,
      requiresHumanReview: true,
      fixtures: [
        ...(newObs && isRecord(newObs.responseSample) ? [{ name: 'new sample from finding', payload: unwrapItems(newObs.responseSample, itemsPath), expectOk: true }] : []),
        ...(oldObs && isRecord(oldObs.responseSample) ? [{ name: 'baseline sample still works', payload: unwrapItems(oldObs.responseSample, itemsPath), expectOk: true }] : []),
      ],
    };
    const rule = await this.deps.repairs.registerRule(spec, actor);
    const updated = await this.deps.store.update(id, { status: 'PROMOTED', ruleId: rule.id, reviewedBy: actor, reviewedAt: new Date(this.now()), reviewNote: note ?? null }, { action: 'ai_proposal.promoted', actor, details: { ruleId: rule.id, ruleKey: rule.key } });
    this.deps.logger.info({ aiProposalId: id, ruleId: rule.id, ruleKey: rule.key }, 'ai proposal promoted to draft rule');
    return { proposal: updated, rule: { id: rule.id, key: rule.key, version: rule.version, status: rule.status } };
  }

  async dismiss(id: string, actor: string, note?: string): Promise<AiProposalRecord> {
    const p = await this.get(id);
    if (p.status === 'PROMOTED' || p.status === 'DISMISSED') throw new ConflictError(`AI proposal is already ${p.status}`);
    return this.deps.store.update(id, { status: 'DISMISSED', reviewedBy: actor, reviewedAt: new Date(this.now()), reviewNote: note ?? null }, { action: 'ai_proposal.dismissed', actor, details: { note: note ?? null } });
  }
}

function assessRisk(output: AiProposalOutput, impact: ImpactReportBody | null, warnings: string[]): RiskLevel {
  let level = 1; // MEDIUM: an AI proposal is never LOW
  if (output.ambiguities.length > 0 || output.confidence === 'low' || output.unsafe_reasons.length > 2) level = 2;
  if (warnings.some((w) => !w.startsWith('samples were reduced'))) level = 2;
  if (impact && (impact.traversal.truncated || impact.summary.unconfirmedEdgesOnBestPaths > 0 || impact.summary.maxLikelihood === 'HIGH')) level = 2;
  if (!impact) level = 2;
  return level >= 2 ? 'HIGH' : 'MEDIUM';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
/** Rule fixtures are single records; take the first item of a list sample. */
function unwrapItems(sample: Record<string, unknown>, itemsPath: string | undefined): Record<string, unknown> {
  if (!itemsPath) return sample;
  const items = sample[itemsPath];
  return Array.isArray(items) && isRecord(items[0]) ? items[0] : sample;
}
