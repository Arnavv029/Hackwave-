import { z } from 'zod';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { GraphService, ImpactReportBody } from '../graph/service.js';
import type { ImpactReportStore } from '../graph/stores.js';
import type { ObservationStore, StoredObservation } from '../observation/store.js';
import type { ProbeRequest } from '../observation/schemas.js';
import { ADAPTERS, findAdapterEndpoint, type AdapterEndpointDefinition } from '../repair/adapters.js';
import { normalize } from '../repair/engine.js';
import type { ProposalRecord, ProposalStore, RuleStore, VersionRecord } from '../repair/stores.js';
import { runValidationPipeline, type CorpusPayload, type ValidationReport } from './pipeline.js';
import { approvalPolicy, type ApprovalRequirement } from './policy.js';
import { DEFAULT_SAFETY, RevisionConflictError, type ActivationStore, type ApprovalRecord, type EventRecord, type PointerRecord, type SafetyConfig, type TestRunInput, type ValidationRunRecord, type VerificationRecord } from './stores.js';

/**
 * Candidate-to-activation lifecycle:
 *
 *   validate  -> full pipeline, persisted as a RepairValidationRun (+ TestRuns)
 *   approve   -> RepairApproval rows; policy decides how many and from whom
 *   activate  -> under lock: re-check validation run for this exact checksum,
 *                approvals, actors, revision; move the pointer; append event
 *   verify    -> probes + normalisation with the live version; thresholds;
 *                optional AUTO_ROLLBACK to the previous known-good version
 *   rollback  -> under lock: restore the previous version; append event
 */

export interface ActivationServiceDeps {
  store: ActivationStore;
  proposals: ProposalStore;
  rules: RuleStore;
  observations: ObservationStore;
  impactReports: ImpactReportStore;
  graph: GraphService;
  /** Runs a real probe through the observation engine (Phase 2). */
  probe: (input: ProbeRequest) => Promise<StoredObservation>;
  logger: Logger;
  now?: () => Date;
}

export const safetySchema = z
  .object({
    minProbes: z.number().int().min(1).max(50).default(3),
    maxErrorRate: z.number().min(0).max(1).default(0.34),
    maxContractViolationRate: z.number().min(0).max(1).default(0),
    autoRollback: z.boolean().default(true),
  })
  .strict();

export interface ActivationResult {
  proposal: ProposalRecord;
  version: VersionRecord;
  superseded: number;
  pointer: PointerRecord;
  event: EventRecord;
  policy: ApprovalRequirement;
}

export interface ReadinessReport {
  ready: boolean;
  blockers: string[];
  policy: ApprovalRequirement | null;
  validationRun: { id: string; status: string; checksum: string; createdAt: string } | null;
  approvals: Array<{ actor: string; decision: string; createdAt: string }>;
}

export class ActivationService {
  private readonly now: () => Date;
  constructor(private readonly deps: ActivationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** What the runtime applies: the pointer's active version. */
  async resolveActiveVersion(adapterKey: string, endpointKey: string): Promise<VersionRecord | null> {
    const p = await this.deps.store.getPointer(adapterKey, endpointKey);
    return p.activeVersionId ? this.deps.proposals.findVersionById(p.activeVersionId) : null;
  }

  // --- validation ------------------------------------------------------------

  async validate(proposalId: string, triggeredBy: string, recentObservations = 10): Promise<ValidationRunRecord & { proposalStatus: string; blockedReason: string | null }> {
    const started = performance.now();
    const { proposal, version, def } = await this.load(proposalId);
    if (!['DRAFT', 'PENDING_REVIEW', 'VALIDATED', 'BLOCKED'].includes(proposal.status)) throw new ConflictError(`Proposal is ${proposal.status}; cannot validate`);
    await this.deps.proposals.update(proposalId, { status: 'VALIDATING', blockedReason: null }, { action: 'repair.validating', actor: triggeredBy });

    const rule = version.spec.ruleKey && version.spec.ruleVersion ? await this.deps.rules.find(version.spec.ruleKey, version.spec.ruleVersion) : null;
    const corpus: CorpusPayload[] = [];
    for (const [i, f] of (rule?.spec.fixtures ?? []).entries()) corpus.push({ source: 'FIXTURE', id: `fixture:${i}:${f.name}`, payload: def.itemsPath ? { [def.itemsPath]: [f.payload] } : f.payload, expectOk: f.expectOk });
    let latestSample: Record<string, unknown> | null = null;
    if (recentObservations > 0) {
      const page = await this.deps.observations.list({ provider: ADAPTERS[version.spec.adapterKey]?.provider as 'payments' | 'shipping', endpoint: version.spec.endpointKey, outcome: 'SUCCESS', sort: 'desc', limit: recentObservations, offset: 0 });
      for (const o of page.rows) {
        if (o.responseSample === null || o.responseSample === undefined) continue;
        corpus.push({ source: 'OBSERVATION', id: o.id, payload: o.responseSample, expectOk: true });
        if (!latestSample && isRecord(o.responseSample)) latestSample = o.responseSample;
      }
    }
    const impact = await this.impactFor(proposal, version);
    const report = runValidationPipeline({ proposal, version, endpoint: def, rule, corpus, impact, latestSample });

    const testRuns: TestRunInput[] = [];
    for (const t of report.regressionTests) {
      const node = await this.deps.graph.getNode(t.testKey).catch(() => null);
      testRuns.push({ repairVersionId: version.id, workflowNodeId: node?.id ?? null, validationRunId: '', testKey: t.testKey, mandatory: t.mandatory, status: t.status === 'SKIPPED' ? 'ERROR' : t.status, triggeredBy, durationMs: t.durationMs, results: t.failures, summary: `${t.status}: ${t.failures.length} failure(s) over ${t.payloads} payload(s)` });
    }
    // Replay results are also kept as RepairExecution rows so GET /api/repairs/:id/report stays complete.
    for (const e of report.replay.executions) {
      await this.deps.proposals.recordExecution(
        { proposalId, repairVersionId: version.id, source: e.source, observationId: e.source === 'OBSERVATION' ? e.id : null, inputHash: e.inputHash, outputHash: e.outputHash, ok: e.ok, output: null, rejections: e.rejections, trace: [], contractValid: e.contractValid, durationMs: 0, executedBy: triggeredBy },
        { action: e.ok ? 'repair.executed' : 'repair.execution_rejected', actor: triggeredBy, details: { proposalId, source: e.source, stage: 'replay' } },
      );
    }
    const run = await this.deps.store.saveValidationRun(
      { proposalId, repairVersionId: version.id, checksum: version.checksum, status: report.status, report, reportHash: report.reportHash, totalTests: report.totalTests, mandatoryFailures: report.mandatoryFailures, triggeredBy, durationMs: Math.max(0, Math.round(performance.now() - started)) },
      testRuns,
    );
    if (report.status === 'PASSED') {
      await this.deps.proposals.setVersionStatus(version.id, 'VALIDATED');
      const p = await this.deps.proposals.update(proposalId, { status: 'VALIDATED', blockedReason: null }, { action: 'repair.validated', actor: triggeredBy, details: { validationRunId: run.id, reportHash: report.reportHash } });
      this.deps.logger.info({ proposalId, validationRunId: run.id, tests: report.totalTests }, 'repair validation passed');
      return { ...run, proposalStatus: p.status, blockedReason: null };
    }
    const reason = describeFailure(report);
    await this.deps.proposals.setVersionStatus(version.id, 'FAILED');
    const p = await this.deps.proposals.update(proposalId, { status: 'BLOCKED', blockedReason: reason }, { action: 'repair.blocked', actor: triggeredBy, details: { validationRunId: run.id, reason } });
    this.deps.logger.warn({ proposalId, validationRunId: run.id, reason }, 'repair validation failed');
    return { ...run, proposalStatus: p.status, blockedReason: reason };
  }

  listValidationRuns(proposalId: string): Promise<ValidationRunRecord[]> {
    return this.deps.store.listValidationRuns(proposalId, 20);
  }

  // --- approvals -------------------------------------------------------------

  async approve(proposalId: string, actor: string, note?: string): Promise<{ approval: ApprovalRecord; readiness: ReadinessReport }> {
    const { proposal, version } = await this.load(proposalId);
    if (proposal.status !== 'VALIDATED') throw new ConflictError(`Proposal is ${proposal.status}; only VALIDATED proposals can be approved`, { hint: 'run validate first' });
    if (proposal.createdBy === actor && proposal.createdBy !== 'system') throw new ValidationError('A proposal cannot be approved by the actor who created it');
    const existing = await this.deps.store.listApprovals(proposalId);
    if (existing.some((a) => a.actor === actor && a.repairVersionId === version.id && a.decision === 'APPROVE')) throw new ConflictError(`${actor} has already approved this version`);
    const run = await this.deps.store.latestValidationRun(proposalId);
    const approval = await this.deps.store.addApproval({ proposalId, repairVersionId: version.id, validationRunId: run?.id ?? null, actor, decision: 'APPROVE', note: note ?? null });
    await this.deps.proposals.update(proposalId, { reviewedBy: actor, reviewedAt: this.now(), reviewNote: note ?? null }, { action: 'repair.approval_recorded', actor, details: { approvalId: approval.id } });
    return { approval, readiness: await this.readiness(proposalId) };
  }

  async reject(proposalId: string, actor: string, note?: string): Promise<ProposalRecord> {
    const { proposal, version } = await this.load(proposalId);
    if (['ACTIVE', 'ROLLED_BACK', 'REJECTED'].includes(proposal.status)) throw new ConflictError(`Proposal is ${proposal.status}; cannot reject`);
    await this.deps.store.addApproval({ proposalId, repairVersionId: version.id, validationRunId: null, actor, decision: 'REJECT', note: note ?? null });
    return this.deps.proposals.update(proposalId, { status: 'REJECTED', reviewedBy: actor, reviewedAt: this.now(), reviewNote: note ?? null }, { action: 'repair.rejected', actor, details: { note: note ?? null } });
  }

  listApprovals(proposalId: string): Promise<ApprovalRecord[]> {
    return this.deps.store.listApprovals(proposalId);
  }

  /** Everything activation will check, without changing anything. */
  async readiness(proposalId: string, activator?: string): Promise<ReadinessReport> {
    const { proposal, version, def } = await this.load(proposalId);
    const run = await this.deps.store.latestValidationRun(proposalId);
    const approvals = (await this.deps.store.listApprovals(proposalId)).filter((a) => a.repairVersionId === version.id);
    const approvers = approvals.filter((a) => a.decision === 'APPROVE').map((a) => a.actor);
    const blockers: string[] = [];
    if (proposal.status !== 'VALIDATED') blockers.push(`proposal is ${proposal.status}, must be VALIDATED`);
    if (!run) blockers.push('no validation run');
    else {
      if (run.status !== 'PASSED') blockers.push(`latest validation run ${run.status}`);
      if (run.checksum !== version.checksum) blockers.push('latest validation run is for a different candidate checksum');
      if (run.mandatoryFailures > 0) blockers.push(`${run.mandatoryFailures} mandatory test failure(s)`);
    }
    if (version.status !== 'VALIDATED') blockers.push(`version is ${version.status}`);
    const impact = run?.report.selection.fromImpact ? await this.impactFor(proposal, version) : null;
    const policy = approvalPolicy({
      proposal,
      version,
      endpoint: def,
      selectedTests: run?.report.regressionTests.length ?? 0,
      mandatoryFailures: run?.mandatoryFailures ?? 0,
      impactMaxLikelihood: impact?.summary.maxLikelihood ?? null,
      impactHasCriticalDependents: impact?.dependents.some((d) => d.likelihood === 'HIGH' && (d.node.criticality === 'CRITICAL' || d.node.criticality === 'HIGH')) ?? false,
    });
    const distinct = new Set(approvers);
    if (distinct.size < policy.requiredApprovals) blockers.push(`${distinct.size}/${policy.requiredApprovals} required approval(s) recorded${policy.requiredApprovals > 1 ? ' (distinct approvers)' : ''}`);
    if (approvals.some((a) => a.decision === 'REJECT')) blockers.push('a reviewer rejected this version');
    if (activator && distinct.has(activator)) blockers.push('the activator cannot be one of the approvers');
    if (activator && activator === proposal.createdBy && activator !== 'system') blockers.push('the activator cannot be the proposal creator');
    return { ready: blockers.length === 0, blockers, policy, validationRun: run ? { id: run.id, status: run.status, checksum: run.checksum, createdAt: run.createdAt.toISOString() } : null, approvals: approvals.map((a) => ({ actor: a.actor, decision: a.decision, createdAt: a.createdAt.toISOString() })) };
  }

  // --- activation ------------------------------------------------------------

  async activate(proposalId: string, actor: string, expectedRevision?: number): Promise<ActivationResult> {
    const { version } = await this.load(proposalId);
    const adapterKey = version.spec.adapterKey;
    const endpointKey = version.spec.endpointKey;
    return this.deps.store.withLock(adapterKey, endpointKey, async () => {
      // Re-check everything inside the lock: state may have moved while we waited.
      const readiness = await this.readiness(proposalId, actor);
      if (!readiness.ready) throw new ConflictError(`Activation refused: ${readiness.blockers.join('; ')}`, { blockers: readiness.blockers, policy: readiness.policy });
      const pointer = await this.deps.store.getPointer(adapterKey, endpointKey);
      if (expectedRevision !== undefined && pointer.revision !== expectedRevision) throw new ConflictError(`Activation pointer is at revision ${pointer.revision}, not ${expectedRevision}; reload and retry`, { revision: pointer.revision });
      if (pointer.activeVersionId === version.id) throw new ConflictError('This version is already active');

      const statusResult = await this.deps.proposals.activate(proposalId, version.id, actor, this.now());
      let updated: PointerRecord;
      try {
        updated = await this.deps.store.updatePointer(adapterKey, endpointKey, pointer.revision, { activeVersionId: version.id, previousVersionId: pointer.activeVersionId, updatedBy: actor });
      } catch (err) {
        if (err instanceof RevisionConflictError) throw new ConflictError(err.message, { expected: err.expected, actual: err.actual });
        throw err;
      }
      const event = await this.deps.store.appendEvent({
        adapterKey,
        endpointKey,
        kind: 'ACTIVATE',
        fromVersionId: pointer.activeVersionId,
        toVersionId: version.id,
        proposalId,
        revision: updated.revision,
        actor,
        initiator: 'HUMAN',
        evidence: { validationRun: readiness.validationRun, approvals: readiness.approvals, policy: readiness.policy, checksum: version.checksum, confirmed: true },
        reason: null,
      });
      this.deps.logger.info({ proposalId, versionId: version.id, adapterKey, endpointKey, revision: updated.revision, actor, approvers: readiness.approvals.map((a) => a.actor) }, 'repair activated');
      return { proposal: statusResult.proposal, version: statusResult.version, superseded: statusResult.superseded, pointer: updated, event, policy: readiness.policy as ApprovalRequirement };
    });
  }

  // --- verification ------------------------------------------------------------

  async verify(adapterKey: string, endpointKey: string, triggeredBy: string, probes?: number): Promise<VerificationRecord & { rolledBackTo: string | null }> {
    const def = findAdapterEndpoint(adapterKey, endpointKey);
    if (!def) throw new NotFoundError(`Adapter ${adapterKey} does not normalise ${endpointKey}`);
    const pointer = await this.deps.store.getPointer(adapterKey, endpointKey);
    if (!pointer.activeVersionId) throw new ConflictError('No active repair version to verify');
    const version = await this.deps.proposals.findVersionById(pointer.activeVersionId);
    const event = await this.deps.store.latestEvent(adapterKey, endpointKey);
    if (!version || !event) throw new ConflictError('Active version has no activation event');
    const safety = { ...DEFAULT_SAFETY, ...pointer.safety };
    const n = Math.max(safety.minProbes, Math.min(probes ?? safety.minProbes, 20));

    const results: Array<{ observationId: string; outcome: string; statusCode: number | null; normalized: boolean | null; rejections: string[] }> = [];
    for (let i = 0; i < n; i += 1) {
      const obs = await this.deps.probe({ provider: ADAPTERS[adapterKey]?.provider as 'payments' | 'shipping', endpoint: def.verification.endpointName, pathParams: def.verification.pathParams ?? {}, query: def.verification.query ?? {}, ...(def.verification.body ? { body: def.verification.body } : {}), correlationId: `verify-${version.id.slice(0, 8)}-${i}` });
      let normalized: boolean | null = null;
      let rejections: string[] = [];
      if (obs.outcome === 'SUCCESS' && obs.responseSample !== null && obs.responseSample !== undefined) {
        const r = normalize({ definition: def, payload: obs.responseSample, transforms: version.spec.transforms, policy: version.spec.policy });
        normalized = r.ok;
        rejections = [...new Set(r.rejections.map((x) => x.code))];
      }
      results.push({ observationId: obs.id, outcome: obs.outcome, statusCode: obs.statusCode, normalized, rejections });
    }
    const probeErrors = results.filter((r) => r.outcome !== 'SUCCESS').length;
    const successes = results.length - probeErrors;
    const contractViolations = results.filter((r) => r.normalized === false).length;
    const errorRate = results.length ? probeErrors / results.length : 0;
    const violationRate = successes ? contractViolations / successes : 0;
    // Recent traffic, for context (not a gate on its own).
    const recent = await this.deps.observations.list({ provider: ADAPTERS[adapterKey]?.provider as 'payments' | 'shipping', endpoint: endpointKey, sort: 'desc', limit: 20, offset: 0 });
    const recentErrorRate = recent.rows.length ? recent.rows.filter((o) => o.outcome !== 'SUCCESS').length / recent.rows.length : 0;
    const passed = errorRate <= safety.maxErrorRate && violationRate <= safety.maxContractViolationRate && successes > 0;

    let action: 'NONE' | 'AUTO_ROLLBACK' = 'NONE';
    let rolledBackTo: string | null = null;
    if (!passed && safety.autoRollback) {
      const rb = await this.rollbackPointer(adapterKey, endpointKey, 'system', `post-activation verification failed: errorRate=${errorRate.toFixed(2)}, contractViolationRate=${violationRate.toFixed(2)}`, 'AUTO_ROLLBACK');
      action = 'AUTO_ROLLBACK';
      rolledBackTo = rb.pointer.activeVersionId;
    }
    const record = await this.deps.store.saveVerification({ activationEventId: event.id, adapterKey, endpointKey, versionId: version.id, probes: results.length, probeErrors, contractViolations, passed, thresholds: safety, details: { results, errorRate, contractViolationRate: violationRate, recentErrorRate, recentObservations: recent.rows.length }, action, triggeredBy });
    if (passed) {
      const latest = await this.deps.store.getPointer(adapterKey, endpointKey);
      if (latest.activeVersionId === version.id) await this.deps.store.updatePointer(adapterKey, endpointKey, latest.revision, { activeVersionId: latest.activeVersionId, previousVersionId: latest.previousVersionId, lastGoodVersionId: version.id, updatedBy: triggeredBy });
    }
    this.deps.logger[passed ? 'info' : 'warn']({ adapterKey, endpointKey, versionId: version.id, probes: results.length, probeErrors, contractViolations, passed, action }, 'post-activation verification');
    return { ...record, rolledBackTo };
  }

  // --- rollback ----------------------------------------------------------------

  /** Manual rollback by proposal: restores the previous known-good version for that proposal's endpoint. */
  async rollbackProposal(proposalId: string, actor: string, reason: string): Promise<{ proposal: ProposalRecord; pointer: PointerRecord; event: EventRecord; restoredVersionId: string | null }> {
    const { proposal, version } = await this.load(proposalId);
    const pointer = await this.deps.store.getPointer(version.spec.adapterKey, version.spec.endpointKey);
    if (pointer.activeVersionId !== version.id) {
      if (proposal.status === 'ACTIVE') throw new ConflictError('Proposal is marked ACTIVE but its version is not the live one; use the pointer rollback endpoint');
      throw new ConflictError(`Proposal is ${proposal.status} and its version is not active; nothing to roll back`);
    }
    const r = await this.rollbackPointer(version.spec.adapterKey, version.spec.endpointKey, actor, reason, 'ROLLBACK');
    return { proposal: (await this.deps.proposals.findById(proposalId)) as ProposalRecord, pointer: r.pointer, event: r.event, restoredVersionId: r.pointer.activeVersionId };
  }

  /** Rollback by endpoint. Target: previous version if it is known-good (or simply previous), else no repair. */
  async rollbackPointer(adapterKey: string, endpointKey: string, actor: string, reason: string, kind: 'ROLLBACK' | 'AUTO_ROLLBACK' = 'ROLLBACK'): Promise<{ pointer: PointerRecord; event: EventRecord }> {
    return this.deps.store.withLock(adapterKey, endpointKey, async () => {
      const pointer = await this.deps.store.getPointer(adapterKey, endpointKey);
      if (!pointer.activeVersionId) throw new ConflictError('No active repair version to roll back');
      const current = await this.deps.proposals.findVersionById(pointer.activeVersionId);
      let target: VersionRecord | null = pointer.previousVersionId ? await this.deps.proposals.findVersionById(pointer.previousVersionId) : null;
      // Prefer the last known-good version when the previous one failed verification or is gone.
      if ((!target || target.status === 'FAILED') && pointer.lastGoodVersionId && pointer.lastGoodVersionId !== pointer.activeVersionId) target = await this.deps.proposals.findVersionById(pointer.lastGoodVersionId);
      if (target && (target.status === 'ROLLED_BACK' || target.status === 'FAILED')) target = null;

      if (current) {
        await this.deps.proposals.setVersionStatus(current.id, 'ROLLED_BACK');
        await this.deps.proposals.update(current.proposalId, { status: 'ROLLED_BACK', blockedReason: reason }, { action: 'repair.rolled_back', actor, details: { reason, kind } });
      }
      if (target) {
        await this.deps.proposals.setVersionStatus(target.id, 'ACTIVE');
        await this.deps.proposals.update(target.proposalId, { status: 'ACTIVE', blockedReason: null }, { action: 'repair.restored', actor, details: { reason, kind } });
      }
      const updated = await this.deps.store.updatePointer(adapterKey, endpointKey, pointer.revision, { activeVersionId: target?.id ?? null, previousVersionId: null, updatedBy: actor });
      const event = await this.deps.store.appendEvent({ adapterKey, endpointKey, kind, fromVersionId: pointer.activeVersionId, toVersionId: target?.id ?? null, proposalId: current?.proposalId ?? null, revision: updated.revision, actor, initiator: kind === 'AUTO_ROLLBACK' ? 'SYSTEM' : 'HUMAN', evidence: { reason, restored: target ? { versionId: target.id, proposalId: target.proposalId } : 'no repair (base adapter)' }, reason });
      this.deps.logger.warn({ adapterKey, endpointKey, from: pointer.activeVersionId, to: target?.id ?? null, kind, actor, reason }, 'repair rolled back');
      return { pointer: updated, event };
    });
  }

  // --- read -------------------------------------------------------------------

  async pointerWithHistory(adapterKey: string, endpointKey: string): Promise<{ pointer: PointerRecord; active: VersionRecord | null; events: EventRecord[]; verifications: VerificationRecord[] }> {
    const pointer = await this.deps.store.getPointer(adapterKey, endpointKey);
    return { pointer, active: pointer.activeVersionId ? await this.deps.proposals.findVersionById(pointer.activeVersionId) : null, events: await this.deps.store.listEvents(adapterKey, endpointKey, 50), verifications: await this.deps.store.listVerifications(adapterKey, endpointKey, 20) };
  }

  listPointers(): Promise<PointerRecord[]> {
    return this.deps.store.listPointers();
  }

  async setSafety(adapterKey: string, endpointKey: string, safety: SafetyConfig, actor: string): Promise<PointerRecord> {
    if (!findAdapterEndpoint(adapterKey, endpointKey)) throw new NotFoundError(`Adapter ${adapterKey} does not normalise ${endpointKey}`);
    return this.deps.store.withLock(adapterKey, endpointKey, async () => {
      const p = await this.deps.store.getPointer(adapterKey, endpointKey);
      return this.deps.store.updatePointer(adapterKey, endpointKey, p.revision, { activeVersionId: p.activeVersionId, previousVersionId: p.previousVersionId, safety, updatedBy: actor });
    });
  }

  // --- helpers ------------------------------------------------------------------

  private async load(proposalId: string): Promise<{ proposal: ProposalRecord; version: VersionRecord; def: AdapterEndpointDefinition }> {
    const proposal = await this.deps.proposals.findById(proposalId);
    if (!proposal) throw new NotFoundError('Repair proposal not found');
    if (proposal.kind === 'MANUAL_REVIEW') throw new ConflictError('A MANUAL_REVIEW proposal has no transform to validate or activate');
    const version = await this.deps.proposals.latestVersion(proposalId);
    if (!version) throw new ConflictError('Proposal has no repair version');
    const def = findAdapterEndpoint(version.spec.adapterKey, version.spec.endpointKey);
    if (!def) throw new UnprocessableError(`Adapter ${version.spec.adapterKey} no longer normalises ${version.spec.endpointKey}`);
    return { proposal, version, def };
  }

  private async impactFor(proposal: ProposalRecord, version: VersionRecord): Promise<ImpactReportBody | null> {
    if (proposal.impactReportId) {
      const r = await this.deps.impactReports.findById(proposal.impactReportId);
      if (r) return r.report as unknown as ImpactReportBody;
    }
    const opKey = `${ADAPTERS[version.spec.adapterKey]?.provider ?? ''}:${version.spec.endpointKey.replace(' ', ':')}`;
    try {
      const path = typeof proposal.matchEvidence['change'] === 'object' && proposal.matchEvidence['change'] ? (proposal.matchEvidence['change'] as { path?: string | null }).path ?? undefined : undefined;
      return await this.deps.graph.impactForNode(opKey, { rule: 'repair.validation', severity: proposal.risk === 'LOW' ? 'LOW' : proposal.risk === 'MEDIUM' ? 'MEDIUM' : 'HIGH', ...(path ? { changedPath: path } : {}) }, { maxDepth: 6, maxNodes: 500, maxPaths: 200, maxPathsPerNode: 5 });
    } catch {
      return null;
    }
  }
}

function describeFailure(report: ValidationReport): string {
  const failed = report.stages.filter((s) => s.status === 'FAILED').map((s) => `${s.stage}: ${s.summary}`);
  const tests = report.regressionTests.filter((t) => t.status === 'FAILED').map((t) => t.testKey);
  return [...failed, ...(tests.length ? [`failing tests: ${tests.join(', ')}`] : [])].join(' | ').slice(0, 500) || 'validation failed';
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
