import type { ProposalStatus, RepairRuleStatus } from '../generated/prisma/client.js';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { FindingRecord, FindingStore } from '../detection/stores.js';
import type { ImpactReportStore } from '../graph/stores.js';
import type { ImpactReportBody } from '../graph/service.js';
import type { ObservationStore } from '../observation/store.js';
import { ADAPTERS, adaptersForEndpoint, findAdapterEndpoint, type AdapterEndpointDefinition } from './adapters.js';
import { BUILTIN_REPAIR_RULES } from './catalog.js';
import { normalize, type NormalizeResult } from './engine.js';
import { changeFromFinding, matchRules, selectRule, type RuleCandidate } from './matcher.js';
import type { Policy, RepairRuleSpec, Transform } from './schemas.js';
import type { ExecutionRecord, ProposalRecord, ProposalStore, RepairSpec, RuleRecord, RuleStore, VersionRecord } from './stores.js';

/**
 * Repair orchestration. Flow:
 *
 *   register rule -> approve rule (second actor)
 *   propose(finding) -> matcher picks exactly one approved rule, consults the
 *     impact snapshot, creates a DRAFT proposal with a CANDIDATE version
 *   execute(proposal, payloads) -> runs the engine, records executions
 *   validate(proposal) -> replays fixtures + recent observations; all must pass
 *   review(approve) -> PENDING_REVIEW/VALIDATED -> VALIDATED (reviewed)
 *   activate(confirm) -> only VALIDATED + reviewed + explicit confirm
 *
 * Active versions are what `normalizeWithActive()` applies; candidate versions
 * are only ever exercised through execute/validate/dry-run.
 */

export interface RepairServiceDeps {
  rules: RuleStore;
  proposals: ProposalStore;
  findings: FindingStore;
  observations: ObservationStore;
  impactReports: ImpactReportStore;
  logger: Logger;
  now?: () => Date;
  /** Phase 7: the activation pointer decides what is live. Defaults to the proposal store's ACTIVE lookup. */
  resolveActiveVersion?: (adapterKey: string, endpointKey: string) => Promise<VersionRecord | null>;
}

export interface ProposeResult {
  proposal: ProposalRecord;
  version: VersionRecord | null;
  selection: { selected: string | null; reason: string; candidates: Array<{ key: string; version: number; specificity: number; reasons: string[] }> };
}

export interface ExecutionReport {
  proposalId: string;
  versionId: string;
  version: number;
  checksum: string;
  total: number;
  /** Executions that produced a valid internal record. */
  passed: number;
  /** Executions that were rejected (expected or not). */
  failed: number;
  /** Executions whose outcome differed from what the fixture declared (validate only). */
  unexpected?: number;
  reproducible: boolean;
  executions: Array<Pick<ExecutionRecord, 'id' | 'source' | 'observationId' | 'inputHash' | 'outputHash' | 'ok' | 'rejections' | 'contractValid' | 'durationMs'>>;
}

const PROPOSAL_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'VALIDATING', 'BLOCKED', 'REJECTED'],
  PENDING_REVIEW: ['VALIDATING', 'VALIDATED', 'BLOCKED', 'REJECTED'],
  VALIDATING: ['VALIDATED', 'BLOCKED'],
  VALIDATED: ['ACTIVE', 'REJECTED', 'VALIDATING', 'BLOCKED'],
  BLOCKED: ['VALIDATING', 'REJECTED'],
  ACTIVE: ['ROLLED_BACK'],
  ROLLED_BACK: [],
  REJECTED: [],
};

export class RepairService {
  private readonly now: () => Date;
  constructor(private readonly deps: RepairServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // --- rules ---------------------------------------------------------------

  async registerRule(spec: RepairRuleSpec, createdBy: string): Promise<RuleRecord> {
    this.assertRuleTargetsKnownAdapter(spec);
    const fixtureFailures = this.checkFixtures(spec);
    if (fixtureFailures.length) throw new UnprocessableError('Rule fixtures do not behave as declared', { failures: fixtureFailures });
    const rec = await this.deps.rules.register(spec, createdBy, { action: 'rule.registered', actor: createdBy, details: { key: spec.key, transform: spec.transform.type } });
    this.deps.logger.info({ ruleId: rec.id, key: rec.key, version: rec.version }, 'repair rule registered');
    return rec;
  }

  /** Register every built-in rule that is not registered yet (DRAFT; approval is still manual). */
  async seedBuiltinRules(createdBy = 'system'): Promise<RuleRecord[]> {
    const out: RuleRecord[] = [];
    for (const spec of BUILTIN_REPAIR_RULES) {
      const existing = await this.deps.rules.list({ key: spec.key, limit: 1, offset: 0 });
      if (existing.total > 0) continue;
      out.push(await this.registerRule(spec, createdBy));
    }
    return out;
  }

  async getRule(id: string): Promise<RuleRecord> {
    const r = await this.deps.rules.findById(id);
    if (!r) throw new NotFoundError('Repair rule not found');
    return r;
  }

  async approveRule(id: string, approvedBy: string, note?: string): Promise<RuleRecord> {
    const r = await this.getRule(id);
    if (r.status !== 'DRAFT') throw new ConflictError(`Rule is ${r.status}; only DRAFT rules can be approved`);
    if (r.createdBy === approvedBy && r.createdBy !== 'system') throw new ValidationError('A rule cannot be approved by the actor who registered it');
    return this.deps.rules.setStatus(id, 'APPROVED', approvedBy, this.now(), { action: 'rule.approved', actor: approvedBy, details: { key: r.key, version: r.version, note: note ?? null } });
  }

  async retireRule(id: string, actor: string): Promise<RuleRecord> {
    const r = await this.getRule(id);
    if (r.status === 'RETIRED') throw new ConflictError('Rule is already retired');
    return this.deps.rules.setStatus(id, 'RETIRED', actor, this.now(), { action: 'rule.retired', actor, details: { key: r.key, version: r.version } });
  }

  listRules(filter: { provider?: string; status?: RepairRuleStatus; key?: string; limit: number; offset: number }): Promise<{ rows: RuleRecord[]; total: number }> {
    return this.deps.rules.list(filter);
  }

  private assertRuleTargetsKnownAdapter(spec: RepairRuleSpec): void {
    const adapter = ADAPTERS[spec.scope.adapterKey];
    if (!adapter) throw new UnprocessableError(`Unknown adapter "${spec.scope.adapterKey}"`, { known: Object.keys(ADAPTERS) });
    if (adapter.provider !== spec.scope.provider) throw new ValidationError(`Adapter ${spec.scope.adapterKey} belongs to provider ${adapter.provider}, not ${spec.scope.provider}`);
    if (spec.scope.endpointKey !== '*' && !adapter.endpoints[spec.scope.endpointKey]) {
      throw new ValidationError(`Adapter ${spec.scope.adapterKey} does not normalise ${spec.scope.endpointKey}`, { endpoints: Object.keys(adapter.endpoints) });
    }
    // Every internal field the transform writes must exist in the base mapping of each targeted endpoint.
    const targets = spec.scope.endpointKey === '*' ? Object.values(adapter.endpoints) : [adapter.endpoints[spec.scope.endpointKey] as AdapterEndpointDefinition];
    const fields = transformInternalFields(spec.transform);
    for (const t of targets) {
      const known = new Set(t.baseMapping.map((m) => m.internalField));
      const unknown = fields.filter((f) => !known.has(f));
      if (unknown.length) throw new ValidationError(`Transform writes internal fields that are not part of the ${t.contract} contract via ${t.endpointKey}: ${unknown.join(', ')}`, { known: [...known] });
    }
  }

  /** Fixtures bundled with a rule must pass/fail as declared, for each endpoint the rule targets. */
  private checkFixtures(spec: RepairRuleSpec): Array<{ fixture: string; endpointKey: string; expected: boolean; actual: boolean; rejections: NormalizeResult['rejections'] }> {
    const adapter = ADAPTERS[spec.scope.adapterKey];
    if (!adapter) return [];
    const targets = spec.scope.endpointKey === '*' ? Object.values(adapter.endpoints) : [adapter.endpoints[spec.scope.endpointKey] as AdapterEndpointDefinition];
    const failures: Array<{ fixture: string; endpointKey: string; expected: boolean; actual: boolean; rejections: NormalizeResult['rejections'] }> = [];
    for (const t of targets) {
      for (const f of spec.fixtures) {
        // Fixtures are single records; wrap them for list endpoints.
        const payload = t.itemsPath ? { [t.itemsPath]: [f.payload] } : f.payload;
        const r = normalize({ definition: t, payload, transforms: [spec.transform], policy: spec.policy });
        if (r.ok !== f.expectOk) failures.push({ fixture: f.name, endpointKey: t.endpointKey, expected: f.expectOk, actual: r.ok, rejections: r.rejections });
      }
    }
    return failures;
  }

  // --- proposals -----------------------------------------------------------

  async propose(findingId: string, createdBy: string, impactReportId?: string): Promise<ProposeResult> {
    const finding = await this.deps.findings.findById(findingId);
    if (!finding) throw new NotFoundError('Finding not found');
    const approved = await this.deps.rules.listApproved();
    const candidates = matchRules(finding, approved.map((r) => ({ spec: r.spec, version: r.version })));
    const selection = selectRule(candidates);
    const impact = await this.resolveImpact(finding, impactReportId);
    const summary = { selected: selection.selected ? selection.selected.rule.key : null, reason: selection.reason, candidates: candidates.map(toCandidateSummary) };
    const change = changeFromFinding(finding);

    if (!selection.selected) {
      const created = await this.deps.proposals.create(
        {
          findingId,
          kind: 'MANUAL_REVIEW',
          risk: 'HIGH',
          rationale: `No deterministic repair could be selected: ${selection.reason}. A human must decide.`,
          preconditions: impactPreconditions(impact),
          requiresHumanReview: true,
          blockedReason: selection.reason,
          status: 'BLOCKED',
          createdBy,
          derived: false,
          ...(impact ? { impactReportId: impact.id } : {}),
          endpointKey: finding.endpointKey,
          matchEvidence: { change, ...summary },
        },
        { action: 'repair.rejected', actor: createdBy, details: { findingId, reason: selection.reason, candidates: candidates.length } },
      );
      this.deps.logger.info({ proposalId: created.proposal.id, findingId, reason: selection.reason }, 'repair blocked: no unambiguous rule');
      return { ...created, selection: summary };
    }

    const rule = selection.selected.rule;
    const adapter = ADAPTERS[rule.scope.adapterKey];
    const endpointDef = adapter?.endpoints[finding.endpointKey];
    if (!adapter || !endpointDef) {
      throw new UnprocessableError(`Rule ${rule.key} targets ${rule.scope.adapterKey}, which does not normalise ${finding.endpointKey}`);
    }
    const spec: RepairSpec = { ruleKey: rule.key, ruleVersion: selection.selected.version, adapterKey: adapter.key, endpointKey: finding.endpointKey, transforms: [rule.transform], policy: rule.policy };
    const risk = escalateRisk(rule.risk, impact, finding);
    const requiresHumanReview = rule.requiresHumanReview || risk !== 'LOW' || finding.rule === 'structural.rename_candidate' || impact === null || impact.report.traversal.truncated;
    const preconditions = [
      { check: 'rule_approved', ruleKey: rule.key, version: selection.selected.version },
      { check: 'validation_passed', description: 'every fixture and replayed observation normalises into the internal contract' },
      { check: 'human_review', required: requiresHumanReview },
      ...impactPreconditions(impact),
    ];
    const created = await this.deps.proposals.create(
      {
        findingId,
        kind: rule.transform.type === 'enum_mapping' ? 'ENUM_MAPPING' : 'FIELD_MAPPING',
        risk,
        rationale: buildRationale(rule, finding, impact, selection.selected),
        preconditions,
        requiresHumanReview,
        status: 'DRAFT',
        createdBy,
        ruleKey: rule.key,
        ruleVersion: selection.selected.version,
        derived: finding.rule === 'structural.rename_candidate',
        ...(impact ? { impactReportId: impact.id } : {}),
        adapterKey: adapter.key,
        endpointKey: finding.endpointKey,
        matchEvidence: { change, ...summary, impactReportId: impact?.id ?? null, impactMaxLikelihood: impact?.report.summary.maxLikelihood ?? null },
        spec,
      },
      { action: 'repair.proposed', actor: createdBy, details: { findingId, ruleKey: rule.key, ruleVersion: selection.selected.version, risk, requiresHumanReview } },
    );
    this.deps.logger.info({ proposalId: created.proposal.id, findingId, ruleKey: rule.key, risk }, 'repair proposed');
    return { ...created, selection: summary };
  }

  private async resolveImpact(finding: FindingRecord, impactReportId?: string): Promise<{ id: string; report: ImpactReportBody } | null> {
    if (impactReportId) {
      const r = await this.deps.impactReports.findById(impactReportId);
      if (!r) throw new NotFoundError('Impact report not found');
      if (r.findingId !== finding.id) throw new ValidationError('Impact report belongs to a different finding');
      return { id: r.id, report: r.report as unknown as ImpactReportBody };
    }
    const latest = (await this.deps.impactReports.listForFinding(finding.id, 1))[0];
    return latest ? { id: latest.id, report: latest.report as unknown as ImpactReportBody } : null;
  }

  async getProposal(id: string): Promise<ProposalRecord> {
    const p = await this.deps.proposals.findById(id);
    if (!p) throw new NotFoundError('Repair proposal not found');
    return p;
  }

  listProposals(filter: { findingId?: string; status?: ProposalStatus; adapterKey?: string; limit: number; offset: number }): Promise<{ rows: ProposalRecord[]; total: number }> {
    return this.deps.proposals.list(filter);
  }

  listVersions(proposalId: string): Promise<VersionRecord[]> {
    return this.deps.proposals.listVersions(proposalId);
  }

  listExecutions(proposalId: string, limit = 50): Promise<ExecutionRecord[]> {
    return this.deps.proposals.listExecutions(proposalId, limit);
  }

  // --- execution -----------------------------------------------------------

  /** Run the candidate version against explicit payloads (or the finding's observation sample). Never activates anything. */
  async execute(proposalId: string, executedBy: string, payloads?: Array<Record<string, unknown>>): Promise<ExecutionReport> {
    const { proposal, version, def } = await this.loadExecutable(proposalId);
    const inputs: Array<{ source: 'MANUAL' | 'OBSERVATION'; observationId: string | null; payload: unknown }> = [];
    if (payloads && payloads.length) {
      for (const p of payloads) inputs.push({ source: 'MANUAL', observationId: null, payload: p });
    } else {
      const finding = await this.deps.findings.findById(proposal.findingId);
      const obsId = finding?.observationIds.at(-1) ?? finding?.observationId ?? null;
      const obs = obsId ? await this.deps.observations.findById(obsId) : null;
      if (!obs || obs.responseSample === null || obs.responseSample === undefined) throw new UnprocessableError('No payload available: supply `payloads` or make sure the finding has an observation with a response sample');
      inputs.push({ source: 'OBSERVATION', observationId: obs.id, payload: obs.responseSample });
    }
    return this.runAll(proposal, version, def, inputs, executedBy);
  }

  /** Replay rule fixtures and recent observations; the proposal becomes VALIDATED only if everything passes. */
  async validate(proposalId: string, executedBy: string, recentObservations = 10): Promise<ExecutionReport & { status: ProposalStatus; blockedReason: string | null }> {
    const { proposal, version, def } = await this.loadExecutable(proposalId);
    this.assertTransition(proposal, 'VALIDATING');
    await this.deps.proposals.update(proposalId, { status: 'VALIDATING', blockedReason: null }, { action: 'repair.validating', actor: executedBy });
    const inputs: Array<{ source: 'FIXTURE' | 'OBSERVATION' | 'MANUAL'; observationId: string | null; payload: unknown; expectOk?: boolean }> = [];
    const rule = version.spec.ruleKey && version.spec.ruleVersion ? await this.deps.rules.find(version.spec.ruleKey, version.spec.ruleVersion) : null;
    for (const f of rule?.spec.fixtures ?? []) inputs.push({ source: 'FIXTURE', observationId: null, payload: def.itemsPath ? { [def.itemsPath]: [f.payload] } : f.payload, expectOk: f.expectOk });
    if (recentObservations > 0) {
      const page = await this.deps.observations.list({ provider: proposal.adapterKey ? (ADAPTERS[proposal.adapterKey]?.provider as 'payments' | 'shipping') : 'payments', endpoint: version.spec.endpointKey, outcome: 'SUCCESS', sort: 'desc', limit: recentObservations, offset: 0 });
      for (const o of page.rows) if (o.responseSample !== null && o.responseSample !== undefined) inputs.push({ source: 'OBSERVATION', observationId: o.id, payload: o.responseSample, expectOk: true });
    }
    if (inputs.length === 0) {
      const blocked = await this.deps.proposals.update(proposalId, { status: 'BLOCKED', blockedReason: 'nothing to validate against: no fixtures and no successful observations' }, { action: 'repair.blocked', actor: executedBy });
      return { ...emptyReport(proposal, version), status: blocked.status, blockedReason: blocked.blockedReason };
    }
    const report = await this.runAll(proposal, version, def, inputs, executedBy);
    const unexpected = inputs.filter((i, idx) => report.executions[idx] && report.executions[idx].ok !== (i.expectOk ?? true));
    const failed = unexpected.length > 0 || !report.reproducible;
    if (failed) {
      const reason = !report.reproducible ? 'execution was not reproducible (same input produced different output hashes)' : `${unexpected.length} of ${inputs.length} payloads did not behave as expected`;
      await this.deps.proposals.setVersionStatus(version.id, 'FAILED');
      const blocked = await this.deps.proposals.update(proposalId, { status: 'BLOCKED', blockedReason: reason }, { action: 'repair.blocked', actor: executedBy, details: { reason } });
      return { ...report, unexpected: unexpected.length, status: blocked.status, blockedReason: blocked.blockedReason };
    }
    await this.deps.proposals.setVersionStatus(version.id, 'VALIDATED');
    const validated = await this.deps.proposals.update(proposalId, { status: 'VALIDATED', blockedReason: null }, { action: 'repair.validated', actor: executedBy, details: { executions: report.total } });
    return { ...report, unexpected: 0, status: validated.status, blockedReason: null };
  }

  private async loadExecutable(proposalId: string): Promise<{ proposal: ProposalRecord; version: VersionRecord; def: AdapterEndpointDefinition }> {
    const proposal = await this.getProposal(proposalId);
    if (proposal.kind === 'MANUAL_REVIEW') throw new ConflictError('A MANUAL_REVIEW proposal has no transform to execute');
    const version = await this.deps.proposals.latestVersion(proposalId);
    if (!version) throw new ConflictError('Proposal has no repair version');
    const def = findAdapterEndpoint(version.spec.adapterKey, version.spec.endpointKey);
    if (!def) throw new UnprocessableError(`Adapter ${version.spec.adapterKey} no longer normalises ${version.spec.endpointKey}`);
    return { proposal, version, def };
  }

  private async runAll(proposal: ProposalRecord, version: VersionRecord, def: AdapterEndpointDefinition, inputs: Array<{ source: 'FIXTURE' | 'OBSERVATION' | 'MANUAL'; observationId: string | null; payload: unknown }>, executedBy: string): Promise<ExecutionReport> {
    const executions: ExecutionRecord[] = [];
    const seen = new Map<string, string | null>();
    let reproducible = true;
    for (const input of inputs) {
      const started = performance.now();
      const first = normalize({ definition: def, payload: input.payload, transforms: version.spec.transforms, policy: version.spec.policy });
      // Reproducibility check: a second run on the same input must hash identically.
      const second = normalize({ definition: def, payload: input.payload, transforms: version.spec.transforms, policy: version.spec.policy });
      if (first.outputHash !== second.outputHash || first.ok !== second.ok) reproducible = false;
      const prior = seen.get(first.inputHash);
      if (prior !== undefined && prior !== first.outputHash) reproducible = false;
      seen.set(first.inputHash, first.outputHash);
      const rec = await this.deps.proposals.recordExecution(
        {
          proposalId: proposal.id,
          repairVersionId: version.id,
          source: input.source,
          observationId: input.observationId,
          inputHash: first.inputHash,
          outputHash: first.outputHash,
          ok: first.ok,
          output: first.output,
          rejections: first.rejections,
          trace: first.trace,
          contractValid: first.contractValid,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          executedBy,
        },
        { action: first.ok ? 'repair.executed' : 'repair.execution_rejected', actor: executedBy, details: { proposalId: proposal.id, source: input.source, rejections: first.rejections.map((r) => r.code) } },
      );
      executions.push(rec);
    }
    const passed = executions.filter((e) => e.ok).length;
    return {
      proposalId: proposal.id,
      versionId: version.id,
      version: version.version,
      checksum: version.checksum,
      total: executions.length,
      passed,
      failed: executions.length - passed,
      reproducible,
      executions: executions.map(({ id, source, observationId, inputHash, outputHash, ok, rejections, contractValid, durationMs }) => ({ id, source, observationId, inputHash, outputHash, ok, rejections, contractValid, durationMs })),
    };
  }

  // --- lifecycle -----------------------------------------------------------

  async submit(proposalId: string, actor: string): Promise<ProposalRecord> {
    const p = await this.getProposal(proposalId);
    this.assertTransition(p, 'PENDING_REVIEW');
    return this.deps.proposals.update(proposalId, { status: 'PENDING_REVIEW' }, { action: 'repair.submitted', actor });
  }

  async review(proposalId: string, decision: 'approve' | 'reject', reviewer: string, note?: string): Promise<ProposalRecord> {
    const p = await this.getProposal(proposalId);
    if (decision === 'reject') {
      this.assertTransition(p, 'REJECTED');
      return this.deps.proposals.update(proposalId, { status: 'REJECTED', reviewedBy: reviewer, reviewedAt: this.now(), reviewNote: note ?? null }, { action: 'repair.rejected', actor: reviewer, details: { note: note ?? null } });
    }
    if (p.kind === 'MANUAL_REVIEW') throw new ConflictError('A MANUAL_REVIEW proposal cannot be approved; register a rule and propose again');
    if (p.status !== 'VALIDATED') throw new ConflictError(`Proposal is ${p.status}; only VALIDATED proposals can be approved`, { hint: 'run validate first' });
    if (p.createdBy === reviewer && p.createdBy !== 'system') throw new ValidationError('A proposal cannot be approved by the actor who created it');
    return this.deps.proposals.update(proposalId, { reviewedBy: reviewer, reviewedAt: this.now(), reviewNote: note ?? null }, { action: 'repair.approved', actor: reviewer, details: { note: note ?? null } });
  }

  /** Explicit, confirmed activation. Matching, validation and review are each necessary; none is sufficient. */
  async activate(proposalId: string, actor: string): Promise<{ proposal: ProposalRecord; version: VersionRecord; superseded: number }> {
    const p = await this.getProposal(proposalId);
    this.assertTransition(p, 'ACTIVE');
    if (p.status !== 'VALIDATED') throw new ConflictError(`Proposal is ${p.status}; it must be VALIDATED`);
    if (p.requiresHumanReview && !p.reviewedBy) throw new ConflictError('Proposal requires human review before activation', { preconditions: p.preconditions });
    if (p.reviewedBy === actor && actor !== 'system') throw new ValidationError('The reviewer cannot also activate the proposal');
    const version = await this.deps.proposals.latestVersion(proposalId);
    if (!version || version.status !== 'VALIDATED') throw new ConflictError('Latest repair version is not VALIDATED');
    const result = await this.deps.proposals.activate(proposalId, version.id, actor, this.now());
    this.deps.logger.info({ proposalId, versionId: version.id, adapterKey: p.adapterKey, endpointKey: p.endpointKey, superseded: result.superseded }, 'repair activated');
    return result;
  }

  async rollback(proposalId: string, actor: string, reason: string): Promise<ProposalRecord> {
    const p = await this.getProposal(proposalId);
    this.assertTransition(p, 'ROLLED_BACK');
    const version = await this.deps.proposals.latestVersion(proposalId);
    if (version) await this.deps.proposals.setVersionStatus(version.id, 'ROLLED_BACK');
    return this.deps.proposals.update(proposalId, { status: 'ROLLED_BACK', blockedReason: reason }, { action: 'repair.rolled_back', actor, details: { reason } });
  }

  private assertTransition(p: ProposalRecord, target: ProposalStatus): void {
    if (!PROPOSAL_TRANSITIONS[p.status].includes(target)) throw new ConflictError(`Proposal is ${p.status}; cannot move to ${target}`, { allowed: PROPOSAL_TRANSITIONS[p.status] });
  }

  // --- runtime -------------------------------------------------------------

  /** Normalise a payload with the ACTIVE repair (if any) or, for a dry run, with a candidate proposal's version. */
  async normalizeWithActive(adapterKey: string, endpointKey: string, payload: unknown, proposalId?: string): Promise<NormalizeResult & { applied: { proposalId: string; versionId: string; version: number; status: string } | null }> {
    const def = findAdapterEndpoint(adapterKey, endpointKey);
    if (!def) throw new NotFoundError(`Adapter ${adapterKey} does not normalise ${endpointKey}`, { adapters: Object.keys(ADAPTERS) });
    let version: VersionRecord | null;
    if (proposalId) {
      const p = await this.getProposal(proposalId);
      if (p.adapterKey !== adapterKey || p.endpointKey !== endpointKey) throw new ValidationError('Proposal targets a different adapter endpoint');
      version = await this.deps.proposals.latestVersion(proposalId);
    } else {
      version = this.deps.resolveActiveVersion ? await this.deps.resolveActiveVersion(adapterKey, endpointKey) : await this.deps.proposals.findActiveVersion(adapterKey, endpointKey);
    }
    const transforms: Transform[] = version?.spec.transforms ?? [];
    const policy: Policy = version?.spec.policy ?? { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false };
    const result = normalize({ definition: def, payload, transforms, policy });
    return { ...result, applied: version ? { proposalId: version.proposalId, versionId: version.id, version: version.version, status: version.status } : null };
  }

  adapterCatalog(): Array<{ key: string; provider: string; endpoints: Array<{ endpointKey: string; contract: string; baseMapping: AdapterEndpointDefinition['baseMapping']; itemsPath?: string }> }> {
    return Object.values(ADAPTERS).map((a) => ({ key: a.key, provider: a.provider, endpoints: Object.values(a.endpoints).map((e) => ({ endpointKey: e.endpointKey, contract: e.contract, baseMapping: e.baseMapping, ...(e.itemsPath ? { itemsPath: e.itemsPath } : {}) })) }));
  }
}

function transformInternalFields(t: Transform): string[] {
  switch (t.type) {
    case 'rename_field':
      return [t.internalField];
    case 'field_path_mapping':
      return t.mappings.map((m) => m.internalField);
    case 'enum_mapping':
      return [t.internalField];
  }
}

function toCandidateSummary(c: RuleCandidate): { key: string; version: number; specificity: number; reasons: string[] } {
  return { key: c.rule.key, version: c.version, specificity: c.specificity, reasons: c.reasons };
}

function impactPreconditions(impact: { id: string; report: ImpactReportBody } | null): Array<Record<string, unknown>> {
  if (!impact) return [{ check: 'impact_report', satisfied: false, description: 'no persisted impact report for this finding; run POST /api/findings/:id/impact first' }];
  const r = impact.report;
  const tests = r.tests.map((t) => t.node.key);
  const out: Array<Record<string, unknown>> = [
    { check: 'regression_tests', impactReportId: impact.id, tests, description: tests.length ? 'these tests must pass against the candidate before activation' : 'no regression tests cover the impacted path; activation needs manual verification' },
    { check: 'impact_scope', maxLikelihood: r.summary.maxLikelihood, dependents: r.summary.dependents, direct: r.summary.direct },
  ];
  if (r.traversal.truncated) out.push({ check: 'impact_complete', satisfied: false, description: `impact traversal was truncated (${r.traversal.truncationReasons.join(', ')}); rerun with larger limits` });
  if (r.summary.unconfirmedEdgesOnBestPaths > 0) out.push({ check: 'confirm_inferred_edges', count: r.summary.unconfirmedEdgesOnBestPaths, description: 'some dependents are reached only through INFERRED edges; confirm them' });
  return out;
}

function escalateRisk(base: 'LOW' | 'MEDIUM' | 'HIGH', impact: { report: ImpactReportBody } | null, finding: FindingRecord): 'LOW' | 'MEDIUM' | 'HIGH' {
  const order = ['LOW', 'MEDIUM', 'HIGH'] as const;
  let level = order.indexOf(base);
  if (!impact) level = Math.max(level, 1);
  else {
    const critical = impact.report.dependents.some((d) => d.likelihood === 'HIGH' && (d.node.criticality === 'CRITICAL' || d.node.criticality === 'HIGH'));
    if (critical) level = Math.max(level, 1);
    if (impact.report.traversal.truncated || impact.report.summary.unconfirmedEdgesOnBestPaths > 0) level = Math.max(level, 2);
  }
  if (finding.rule === 'structural.rename_candidate' && finding.confidence < 0.5) level = Math.max(level, 1);
  return order[level] ?? 'HIGH';
}

function buildRationale(rule: RepairRuleSpec, finding: FindingRecord, impact: { report: ImpactReportBody } | null, candidate: RuleCandidate): string {
  const parts = [
    `Rule "${rule.title}" (${rule.key} v${candidate.version}) matched finding ${finding.rule} on ${finding.providerKey} ${finding.endpointKey} because: ${candidate.reasons.join('; ')}.`,
    `Transform: ${describeTransform(rule.transform)}. Policy rejects missing, null, mistyped and conflicting values${rule.policy.onExtraFields === 'reject' ? ' and unexpected fields' : '; unexpected fields are dropped'}.`,
  ];
  if (impact) {
    const s = impact.report.summary;
    parts.push(`Impact snapshot: ${s.dependents} dependents (${s.direct} direct), max likelihood ${s.maxLikelihood}, ${s.tests} regression tests${impact.report.traversal.truncated ? ', traversal truncated' : ''}.`);
  } else parts.push('No impact snapshot was available; the blast radius is unknown.');
  if (finding.rule === 'structural.rename_candidate') parts.push('The finding is a rename CANDIDATE; structural similarity is not semantic proof, so human review is mandatory.');
  return parts.join(' ');
}

function describeTransform(t: Transform): string {
  switch (t.type) {
    case 'rename_field':
      return `read external ${t.renamedTo} (formerly ${t.from}) into internal ${t.internalField} as ${t.expectedType}`;
    case 'field_path_mapping':
      return t.mappings.map((m) => `external ${m.from} -> internal ${m.internalField} (${m.expectedType})`).join(', ');
    case 'enum_mapping':
      return `map external ${t.from} values {${Object.entries(t.mapping).map(([k, v]) => `${k}→${v}`).join(', ')}} into internal ${t.internalField}`;
  }
}

function emptyReport(proposal: ProposalRecord, version: VersionRecord): ExecutionReport {
  return { proposalId: proposal.id, versionId: version.id, version: version.version, checksum: version.checksum, total: 0, passed: 0, failed: 0, reproducible: true, executions: [] };
}

export { adaptersForEndpoint };
