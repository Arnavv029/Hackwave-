import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import type { RepairService } from '../repair/service.js';
import { activateSchema, approveRuleSchema, executeSchema, listProposalsQuerySchema, listRulesQuerySchema, normalizeSchema, proposeSchema, registerRuleSchema, reviewProposalSchema, validateSchema, actorSchema } from '../repair/schemas.js';
import { BUILTIN_REPAIR_RULES } from '../repair/catalog.js';
import type { ActivationService } from '../activation/service.js';

export interface RepairRouterDeps {
  service: RepairService;
  /** Phase 7 lifecycle (validate / approve / activate / rollback). */
  activation: ActivationService;
  requireOperator: RequestHandler;
}

const idSchema = z.string().uuid();
const parseId = (raw: unknown): string => {
  const p = idSchema.safeParse(raw);
  if (!p.success) throw new NotFoundError('Not found');
  return p.data;
};
const page = (limit: number, offset: number, count: number, total: number) => ({ limit, offset, total, hasMore: offset + count < total });
const iso = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/**
 *   GET/POST /api/repair-rules                 list / register (operator)
 *   POST     /api/repair-rules/seed            register the built-in examples as DRAFT (operator)
 *   GET      /api/repair-rules/builtin         the built-in catalogue (not necessarily registered)
 *   GET      /api/repair-rules/:id             POST :id/approve | :id/retire (operator)
 */
export function createRepairRulesRouter(deps: Pick<RepairRouterDeps, 'service' | 'requireOperator'>): Router {
  const r = Router();
  const s = deps.service;
  r.get('/', async (req, res) => {
    const q = listRulesQuerySchema.parse(req.query);
    const out = await s.listRules(q);
    res.json({ data: out.rows.map(iso), page: page(q.limit, q.offset, out.rows.length, out.total) });
  });
  r.post('/', deps.requireOperator, async (req, res) => {
    const { spec, createdBy } = registerRuleSchema.parse(req.body);
    res.status(201).json({ data: iso(await s.registerRule(spec, createdBy)) });
  });
  r.get('/builtin', (_req, res) => {
    res.json({ data: BUILTIN_REPAIR_RULES });
  });
  r.post('/seed', deps.requireOperator, async (req, res) => {
    const { createdBy } = z.object({ createdBy: actorSchema.default('system') }).strict().parse(req.body ?? {});
    res.json({ data: (await s.seedBuiltinRules(createdBy)).map(iso) });
  });
  r.get('/:id', async (req, res) => {
    res.json({ data: iso(await s.getRule(parseId(req.params['id']))) });
  });
  r.post('/:id/approve', deps.requireOperator, async (req, res) => {
    const { approvedBy, note } = approveRuleSchema.parse(req.body);
    res.json({ data: iso(await s.approveRule(parseId(req.params['id']), approvedBy, note)) });
  });
  r.post('/:id/retire', deps.requireOperator, async (req, res) => {
    const { actor } = z.object({ actor: actorSchema }).strict().parse(req.body);
    res.json({ data: iso(await s.retireRule(parseId(req.params['id']), actor)) });
  });
  return r;
}

/**
 *   POST /api/repairs/propose                  match a finding to an approved rule (operator)
 *   GET  /api/repairs                          list proposals; GET /:id detail with versions and executions
 *   POST /api/repairs/:id/execute              run the candidate on payloads (operator)
 *   POST /api/repairs/:id/validate             replay fixtures + recent observations (operator)
 *   POST /api/repairs/:id/submit | review | activate | rollback   (operator)
 *   GET  /api/repairs/:id/report               repair execution report
 */
export function createRepairsRouter(deps: RepairRouterDeps): Router {
  const r = Router();
  const s = deps.service;
  r.post('/propose', deps.requireOperator, async (req, res) => {
    const { findingId, impactReportId, createdBy } = proposeSchema.parse(req.body);
    const out = await s.propose(findingId, createdBy, impactReportId);
    res.status(201).json({ data: iso({ proposal: out.proposal, version: out.version, selection: out.selection }) });
  });
  r.get('/', async (req, res) => {
    const q = listProposalsQuerySchema.parse(req.query);
    const out = await s.listProposals(q);
    res.json({ data: out.rows.map(iso), page: page(q.limit, q.offset, out.rows.length, out.total) });
  });
  r.get('/:id', async (req, res) => {
    const id = parseId(req.params['id']);
    const [proposal, versions, executions] = await Promise.all([s.getProposal(id), s.listVersions(id), s.listExecutions(id, 20)]);
    res.json({ data: iso({ ...proposal, versions, executions }) });
  });
  r.get('/:id/report', async (req, res) => {
    const id = parseId(req.params['id']);
    const [proposal, versions, executions] = await Promise.all([s.getProposal(id), s.listVersions(id), s.listExecutions(id, 200)]);
    const latest = versions[0] ?? null;
    const passed = executions.filter((e) => e.ok).length;
    res.json({
      data: iso({
        proposal: { id: proposal.id, status: proposal.status, kind: proposal.kind, risk: proposal.risk, ruleKey: proposal.ruleKey, ruleVersion: proposal.ruleVersion, derived: proposal.derived, adapterKey: proposal.adapterKey, endpointKey: proposal.endpointKey, impactReportId: proposal.impactReportId, requiresHumanReview: proposal.requiresHumanReview, reviewedBy: proposal.reviewedBy, blockedReason: proposal.blockedReason, rationale: proposal.rationale, preconditions: proposal.preconditions },
        version: latest ? { id: latest.id, version: latest.version, status: latest.status, checksum: latest.checksum, spec: latest.spec } : null,
        summary: { executions: executions.length, passed, failed: executions.length - passed, bySource: countBy(executions, (e) => e.source), rejectionCodes: countBy(executions.flatMap((e) => e.rejections), (x) => x.code) },
        executions,
      }),
    });
  });
  r.post('/:id/execute', deps.requireOperator, async (req, res) => {
    const { payloads, executedBy } = executeSchema.parse(req.body ?? {});
    res.json({ data: iso(await s.execute(parseId(req.params['id']), executedBy, payloads)) });
  });
  r.post('/:id/validate', deps.requireOperator, async (req, res) => {
    const { recentObservations, executedBy } = validateSchema.parse(req.body ?? {});
    const run = await deps.activation.validate(parseId(req.params['id']), executedBy, recentObservations);
    // Backward-compatible summary (Phase 5 shape) plus the full Phase 7 report.
    const rp = run.report.replay;
    res.json({
      data: iso({
        validationRunId: run.id,
        status: run.proposalStatus,
        blockedReason: run.blockedReason,
        checksum: run.checksum,
        reportHash: run.reportHash,
        total: rp.total,
        passed: rp.passed,
        failed: rp.failed,
        unexpected: rp.unexpected,
        reproducible: rp.reproducible,
        executions: rp.executions,
        stages: run.report.stages,
        regressionTests: run.report.regressionTests,
        negativeTests: run.report.negativeTests,
        contract: run.report.contract,
        selection: run.report.selection,
        mandatoryFailures: run.mandatoryFailures,
        totalTests: run.totalTests,
      }),
    });
  });
  r.get('/:id/validation-runs', async (req, res) => {
    res.json({ data: iso(await deps.activation.listValidationRuns(parseId(req.params['id']))) });
  });
  r.get('/:id/readiness', async (req, res) => {
    const actor = typeof req.query['actor'] === 'string' ? req.query['actor'] : undefined;
    res.json({ data: iso(await deps.activation.readiness(parseId(req.params['id']), actor)) });
  });
  r.get('/:id/approvals', async (req, res) => {
    res.json({ data: iso(await deps.activation.listApprovals(parseId(req.params['id']))) });
  });
  r.post('/:id/approvals', deps.requireOperator, async (req, res) => {
    const { actor, note } = z.object({ actor: actorSchema, note: z.string().max(1_000).optional() }).strict().parse(req.body);
    res.status(201).json({ data: iso(await deps.activation.approve(parseId(req.params['id']), actor, note)) });
  });
  r.post('/:id/submit', deps.requireOperator, async (req, res) => {
    const { actor } = z.object({ actor: actorSchema }).strict().parse(req.body);
    res.json({ data: iso(await s.submit(parseId(req.params['id']), actor)) });
  });
  r.post('/:id/review', deps.requireOperator, async (req, res) => {
    const b = reviewProposalSchema.parse(req.body);
    const id = parseId(req.params['id']);
    if (b.decision === 'reject') {
      res.json({ data: iso(await deps.activation.reject(id, b.reviewer, b.note)) });
      return;
    }
    const out = await deps.activation.approve(id, b.reviewer, b.note);
    res.json({ data: iso({ ...(await s.getProposal(id)), approval: out.approval, readiness: out.readiness }) });
  });
  r.post('/:id/activate', deps.requireOperator, async (req, res) => {
    const { actor, expectedRevision } = activateSchema.extend({ expectedRevision: z.number().int().min(0).optional() }).strict().parse(req.body);
    res.json({ data: iso(await deps.activation.activate(parseId(req.params['id']), actor, expectedRevision)) });
  });
  r.post('/:id/rollback', deps.requireOperator, async (req, res) => {
    const { actor, reason } = z.object({ actor: actorSchema, reason: z.string().min(1).max(500) }).strict().parse(req.body);
    const out = await deps.activation.rollbackProposal(parseId(req.params['id']), actor, reason);
    res.json({ data: iso({ ...out.proposal, pointer: out.pointer, event: out.event, restoredVersionId: out.restoredVersionId }) });
  });
  return r;
}

/**
 *   GET  /api/adapters                          adapter definitions (base mappings, contracts)
 *   POST /api/adapters/:adapterKey/normalize    normalise a payload with the ACTIVE repair (or a candidate for dry runs)
 */
export function createAdaptersRouter(deps: Pick<RepairRouterDeps, 'service'>): Router {
  const r = Router();
  r.get('/', (_req, res) => {
    res.json({ data: deps.service.adapterCatalog() });
  });
  r.post('/:adapterKey/normalize', async (req, res) => {
    const { endpointKey, payload, proposalId } = normalizeSchema.parse(req.body);
    res.json({ data: await deps.service.normalizeWithActive(String(req.params['adapterKey']), endpointKey, payload, proposalId) });
  });
  return r;
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}
