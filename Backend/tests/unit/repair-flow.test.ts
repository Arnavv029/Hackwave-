import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { InMemoryProposalStore, InMemoryRuleStore } from '../../src/repair/stores.js';
import { BUILTIN_REPAIR_RULES } from '../../src/repair/catalog.js';
import type { ErrorResponseBody } from '../../src/errors.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

const op = { authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
const chargeBody = { amount: 1_250, currency: 'USD', source_token: 'tok_visa' };
interface Proposal { id: string; status: string; kind: string; risk: string; ruleKey: string | null; ruleVersion: number | null; derived: boolean; requiresHumanReview: boolean; blockedReason: string | null; impactReportId: string | null; adapterKey: string | null; endpointKey: string | null; preconditions: Array<Record<string, unknown>>; matchEvidence: Record<string, unknown>; reviewedBy: string | null; rationale: string }
interface Propose { proposal: Proposal; version: { id: string; version: number; status: string; checksum: string; spec: Record<string, unknown> } | null; selection: { selected: string | null; reason: string; candidates: Array<{ key: string }> } }
interface Report { total: number; passed: number; failed: number; unexpected?: number; reproducible: boolean; status?: string; blockedReason?: string | null; executions: Array<{ ok: boolean; source: string; rejections: Array<{ code: string }>; inputHash: string; outputHash: string | null }> }

let t: TestApp;
let app: Express;
beforeEach(async () => {
  t = buildTestApp({ timeoutMs: 400 });
  app = t.app;
  await t.listen();
});
afterEach(async () => {
  await t.close();
});

const post = async (path: string, body: Record<string, unknown> = {}, expectStatus = 200) => {
  const res = await request(app).post(path).set(op).send(body);
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(expectStatus);
  return res.body as { data: never; error?: ErrorResponseBody['error'] };
};
const probe = async (body: Record<string, unknown> = { provider: 'payments', endpoint: 'createCharge', body: chargeBody }) => {
  const res = await request(app).post('/api/probes').send(body);
  expect(res.status).toBe(201);
  return res.body as { data: { id: string }; detection: { findings: Array<{ id: string; rule: string }> } };
};

/** Seed + approve the built-in rules (alice registers, bob approves). */
async function approveBuiltins(): Promise<string[]> {
  const seeded = (await post('/api/repair-rules/seed', { createdBy: 'alice' })).data as Array<{ id: string }>;
  for (const r of seeded) await post(`/api/repair-rules/${r.id}/approve`, { approvedBy: 'bob' });
  return seeded.map((r) => r.id);
}
/** Baseline on payments createCharge (or shipping listShipments), then trigger a scenario and return the finding ids. */
async function findingUnder(scenario: 'schema_rename' | 'semantic_change' | 'unsafe_data', provider: 'payments' | 'shipping' = 'payments', withImpact = true): Promise<{ findings: Array<{ id: string; rule: string }>; impactId: string | null }> {
  const body = provider === 'payments' ? undefined : { provider: 'shipping', endpoint: 'listShipments' };
  for (let i = 0; i < 3; i += 1) await probe(body);
  const b = (await post('/api/baselines', { provider, endpoint: provider === 'payments' ? 'createCharge' : 'listShipments', config: { minSamplesForBaseline: 3, window: { size: 10, minSamples: 4 } }, createdBy: 'alice' }, 201)).data as { id: string };
  await post(`/api/baselines/${b.id}/submit`, { actor: 'alice' });
  await post(`/api/baselines/${b.id}/review`, { decision: 'approve', reviewer: 'bob' });
  await post(`/api/baselines/${b.id}/promote`, { actor: 'carol' });
  t.scenarioStore.activate(provider, scenario);
  const { detection } = await probe(body);
  let impactId: string | null = null;
  if (withImpact && detection.findings[0]) {
    await post('/api/graph/fixtures/commerce-demo');
    const saved = (await post(`/api/findings/${detection.findings[0].id}/impact`, { createdBy: 'erin' }, 201)).data as { id: string };
    impactId = saved.id;
  }
  return { findings: detection.findings, impactId };
}

describe('rule registry', () => {
  it('registers, versions, approves (second actor) and retires rules; validates specs and fixtures', async () => {
    const spec = BUILTIN_REPAIR_RULES[0]!;
    const v1 = (await post('/api/repair-rules', { spec, createdBy: 'alice' }, 201)).data as { id: string; version: number; status: string; checksum: string };
    expect(v1).toMatchObject({ version: 1, status: 'DRAFT' });
    const v2 = (await post('/api/repair-rules', { spec: { ...spec, risk: 'MEDIUM' }, createdBy: 'alice' }, 201)).data as { id: string; version: number; checksum: string };
    expect(v2.version).toBe(2);
    expect(v2.checksum).not.toBe(v1.checksum);
    expect((await request(app).post('/api/repair-rules').send({ spec })).status).toBe(401);
    const self = await request(app).post(`/api/repair-rules/${v1.id}/approve`).set(op).send({ approvedBy: 'alice' });
    expect(self.status).toBe(400);
    await post(`/api/repair-rules/${v1.id}/approve`, { approvedBy: 'bob' });
    await post(`/api/repair-rules/${v1.id}/approve`, { approvedBy: 'bob' }, 409);
    await post(`/api/repair-rules/${v1.id}/retire`, { actor: 'bob' });
    expect(((await request(app).get('/api/repair-rules?status=RETIRED')).body as { page: { total: number } }).page.total).toBe(1);

    // Invalid: unknown adapter, internal field outside the contract, fixture that contradicts the transform, code-shaped transform.
    await post('/api/repair-rules', { spec: { ...spec, scope: { ...spec.scope, adapterKey: 'adapter:Nope' } } }, 422);
    await post('/api/repair-rules', { spec: { ...spec, transform: { ...spec.transform, internalField: 'ghost' } } }, 400);
    const lying = await post('/api/repair-rules', { spec: { ...spec, fixtures: [{ name: 'claims ok', payload: { amount: 1 }, expectOk: true }] } }, 422);
    expect((lying.error as { details?: { failures: unknown[] } }).details?.failures).toHaveLength(2); // scope '*' -> both payments endpoints
    await post('/api/repair-rules', { spec: { ...spec, transform: { type: 'script', code: 'x' } } }, 400);
    expect(((await request(app).get('/api/repair-rules/builtin')).body as { data: unknown[] }).data).toHaveLength(3);
  });
});

describe('propose: matching rules to findings', () => {
  it('matches the rename finding to the approved rename rule and connects the impact report', async () => {
    await approveBuiltins();
    const { findings, impactId } = await findingUnder('schema_rename');
    const removed = findings.find((f) => f.rule === 'structural.field_removed')!;
    const out = (await post('/api/repairs/propose', { findingId: removed.id, createdBy: 'alice' }, 201)).data as Propose;
    expect(out.selection.selected).toBe('payments.charges.transaction_id-to-payment_reference');
    expect(out.proposal).toMatchObject({ status: 'DRAFT', kind: 'FIELD_MAPPING', ruleKey: 'payments.charges.transaction_id-to-payment_reference', ruleVersion: 1, derived: false, requiresHumanReview: true, adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', impactReportId: impactId });
    expect(out.version).toMatchObject({ version: 1, status: 'CANDIDATE' });
    expect(out.version!.spec).toMatchObject({ adapterKey: 'adapter:PaymentsAdapter', transforms: [{ type: 'rename_field' }] });
    const pre = out.proposal.preconditions.map((p) => p['check']);
    expect(pre).toEqual(expect.arrayContaining(['rule_approved', 'validation_passed', 'human_review', 'regression_tests', 'impact_scope']));
    const tests = out.proposal.preconditions.find((p) => p['check'] === 'regression_tests')!['tests'] as string[];
    expect(tests).toContain('test:checkout-regression');
    expect(out.proposal.rationale).toMatch(/Impact snapshot: 6 dependents/);
    // The rename_candidate finding also matches, with higher specificity and marked derived.
    const cand = findings.find((f) => f.rule === 'structural.rename_candidate')!;
    const out2 = (await post('/api/repairs/propose', { findingId: cand.id, createdBy: 'alice' }, 201)).data as Propose;
    expect(out2.proposal.derived).toBe(true);
    expect(out2.proposal.rationale).toMatch(/CANDIDATE/);
    expect((t.proposalStore as InMemoryProposalStore).audit.map((a) => a.action)).toEqual(['repair.proposed', 'repair.proposed']);
  });

  it('creates a BLOCKED manual-review proposal when no rule matches, when rules are not approved, or when the match is ambiguous', async () => {
    const { findings } = await findingUnder('schema_rename', 'payments', false);
    const removed = findings.find((f) => f.rule === 'structural.field_removed')!;
    // Rules exist but are only DRAFT.
    await post('/api/repair-rules/seed', { createdBy: 'alice' });
    const none = (await post('/api/repairs/propose', { findingId: removed.id }, 201)).data as Propose;
    expect(none.proposal).toMatchObject({ status: 'BLOCKED', kind: 'MANUAL_REVIEW', risk: 'HIGH', impactReportId: null });
    expect(none.selection.reason).toMatch(/no approved rule/);
    expect(none.version).toBeNull();
    expect(none.proposal.preconditions[0]).toMatchObject({ check: 'impact_report', satisfied: false });
    // Executing a manual-review proposal is refused; approving it is refused.
    await post(`/api/repairs/${none.proposal.id}/execute`, {}, 409);
    await post(`/api/repairs/${none.proposal.id}/review`, { decision: 'approve', reviewer: 'bob' }, 409);

    // Ambiguity: two approved rules with identical specificity for the same finding.
    const spec = BUILTIN_REPAIR_RULES[0]!;
    const twin = (await post('/api/repair-rules', { spec: { ...spec, key: 'payments.charges.twin-rule' }, createdBy: 'alice' }, 201)).data as { id: string };
    const orig = ((await request(app).get(`/api/repair-rules?key=${spec.key}`)).body as { data: Array<{ id: string }> }).data[0]!;
    await post(`/api/repair-rules/${twin.id}/approve`, { approvedBy: 'bob' });
    await post(`/api/repair-rules/${orig.id}/approve`, { approvedBy: 'bob' });
    const amb = (await post('/api/repairs/propose', { findingId: removed.id }, 201)).data as Propose;
    expect(amb.proposal.status).toBe('BLOCKED');
    expect(amb.proposal.blockedReason).toMatch(/ambiguous/);
    expect(amb.selection.candidates).toHaveLength(2);
    expect((t.proposalStore as InMemoryProposalStore).audit.filter((a) => a.action === 'repair.rejected')).toHaveLength(2);
  });

  it('does not propose anything for a finding whose shape did not change (unsafe data has no structural finding) and 404s on unknown findings', async () => {
    await approveBuiltins();
    const { findings } = await findingUnder('unsafe_data', 'payments', false);
    expect(findings.map((f) => f.rule)).not.toContain('structural.field_removed');
    await post('/api/repairs/propose', { findingId: '00000000-0000-7000-8000-000000000000' }, 404);
    expect((await request(app).post('/api/repairs/propose').send({ findingId: '00000000-0000-7000-8000-000000000000' })).status).toBe(401);
  });

  it('matches the enum finding to the approved enum mapping on shipping', async () => {
    await approveBuiltins();
    const { findings } = await findingUnder('semantic_change', 'shipping', false);
    const enumFinding = findings.find((f) => f.rule === 'behavioral.enum_value_changed')!;
    const out = (await post('/api/repairs/propose', { findingId: enumFinding.id }, 201)).data as Propose;
    expect(out.proposal).toMatchObject({ kind: 'ENUM_MAPPING', ruleKey: 'shipping.shipments.delivery_status-in_transit', adapterKey: 'adapter:ShippingAdapter', endpointKey: 'GET /shipments' });
    expect(out.selection.candidates[0]).toMatchObject({ key: 'shipping.shipments.delivery_status-in_transit' });
  });
});

describe('execute, validate, review, activate', () => {
  async function proposedRename(): Promise<{ proposal: Proposal; findingId: string }> {
    await approveBuiltins();
    const { findings } = await findingUnder('schema_rename');
    const removed = findings.find((f) => f.rule === 'structural.field_removed')!;
    const out = (await post('/api/repairs/propose', { findingId: removed.id, createdBy: 'alice' }, 201)).data as Propose;
    return { proposal: out.proposal, findingId: removed.id };
  }

  it('executes the candidate on the finding observation and on explicit payloads, recording reproducible results', async () => {
    const { proposal } = await proposedRename();
    const fromObs = (await post(`/api/repairs/${proposal.id}/execute`, { executedBy: 'alice' })).data as Report;
    expect(fromObs).toMatchObject({ total: 1, passed: 1, failed: 0, reproducible: true });
    expect(fromObs.executions[0]).toMatchObject({ source: 'OBSERVATION', ok: true });
    const mixed = (await post(`/api/repairs/${proposal.id}/execute`, {
      payloads: [
        { payment_reference: 'txn_a', amount: 1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' },
        { payment_reference: 'txn_a', transaction_id: 'txn_b', amount: 1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' },
        { payment_reference: 'txn_a', amount: -1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' },
      ],
    })).data as Report;
    expect(mixed).toMatchObject({ total: 3, passed: 1, failed: 2, reproducible: true });
    expect(mixed.executions.map((e) => e.rejections.map((r) => r.code))).toEqual([[], ['CONFLICTING_VALUES'], ['CONTRACT_VIOLATION']]);
    // Same input twice -> same hashes.
    const again = (await post(`/api/repairs/${proposal.id}/execute`, { payloads: [{ payment_reference: 'txn_a', amount: 1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }] })).data as Report;
    expect(again.executions[0]!.outputHash).toBe(mixed.executions[0]!.outputHash);
    const detail = (await request(app).get(`/api/repairs/${proposal.id}`)).body as { data: { executions: unknown[]; versions: unknown[]; status: string } };
    expect(detail.data.executions).toHaveLength(5);
    expect(detail.data.status).toBe('DRAFT'); // execution never changes lifecycle state
    const audit = (t.proposalStore as InMemoryProposalStore).audit.map((a) => a.action);
    expect(audit.filter((a) => a === 'repair.executed')).toHaveLength(3);
    expect(audit.filter((a) => a === 'repair.execution_rejected')).toHaveLength(2);
  });

  it('validation replays fixtures and recent observations, then review and confirmed activation make the repair live', async () => {
    const { proposal } = await proposedRename();
    // Activation is refused at every step until the gates are satisfied.
    await post(`/api/repairs/${proposal.id}/activate`, { actor: 'carol', confirm: true }, 409);
    const v = (await post(`/api/repairs/${proposal.id}/validate`, { executedBy: 'alice' })).data as Report;
    expect(v.status).toBe('VALIDATED');
    expect(v.unexpected).toBe(0);
    expect(v.failed).toBe(1); // the "conflict is rejected" fixture is expected to fail
    expect(v.executions.map((e) => e.source)).toEqual(expect.arrayContaining(['FIXTURE', 'OBSERVATION']));
    expect(v.executions.filter((e) => e.source === 'FIXTURE')).toHaveLength(3);
    // Still not activatable: human review required and missing.
    const noReview = await request(app).post(`/api/repairs/${proposal.id}/activate`).set(op).send({ actor: 'carol', confirm: true });
    expect(noReview.status).toBe(409);
    expect((noReview.body as ErrorResponseBody).error.message).toMatch(/required approval/);
    await post(`/api/repairs/${proposal.id}/review`, { decision: 'approve', reviewer: 'alice' }, 400); // creator cannot approve
    const reviewed = (await post(`/api/repairs/${proposal.id}/review`, { decision: 'approve', reviewer: 'bob', note: 'checked mapping' })).data as Proposal & { readiness: { ready: boolean; blockers: string[]; policy: { requiredApprovals: number } } };
    expect(reviewed).toMatchObject({ status: 'VALIDATED', reviewedBy: 'bob' });
    // Policy: HIGH-likelihood impact on the CRITICAL checkout workflow needs two distinct approvers.
    expect(reviewed.readiness.policy.requiredApprovals).toBe(2);
    expect(reviewed.readiness.ready).toBe(false);
    await post(`/api/repairs/${proposal.id}/activate`, { actor: 'carol', confirm: true }, 409);
    await post(`/api/repairs/${proposal.id}/approvals`, { actor: 'bob' }, 409); // same approver twice does not count
    await post(`/api/repairs/${proposal.id}/approvals`, { actor: 'dana', note: 'second pair of eyes' }, 201);
    await post(`/api/repairs/${proposal.id}/activate`, { actor: 'bob', confirm: true }, 409); // an approver cannot activate
    await post(`/api/repairs/${proposal.id}/activate`, { actor: 'carol' }, 400); // confirm is mandatory
    const active = (await post(`/api/repairs/${proposal.id}/activate`, { actor: 'carol', confirm: true })).data as { proposal: Proposal; version: { status: string }; superseded: number };
    expect(active.proposal.status).toBe('ACTIVE');
    expect(active.version.status).toBe('ACTIVE');

    // Runtime: the adapter now applies the ACTIVE version; before activation the same payload failed.
    const renamed = { payment_reference: 'txn_live', amount: 5, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' };
    const live = (await request(app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'POST /charges', payload: renamed })).body as { data: { ok: boolean; output: { paymentId: string }; applied: { proposalId: string; status: string } } };
    expect(live.data.ok).toBe(true);
    expect(live.data.output.paymentId).toBe('txn_live');
    expect(live.data.applied).toMatchObject({ proposalId: proposal.id, status: 'ACTIVE' });
    const other = (await request(app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'GET /charges/:id', payload: renamed })).body as { data: { ok: boolean; applied: unknown } };
    expect(other.data.ok).toBe(false); // activation is per endpoint
    expect(other.data.applied).toBeNull();

    const audit = (t.proposalStore as InMemoryProposalStore).audit.map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['repair.proposed', 'repair.validating', 'repair.validated', 'repair.approval_recorded', 'repair.activated']));
    const rolled = (await post(`/api/repairs/${proposal.id}/rollback`, { actor: 'carol', reason: 'provider reverted' })).data as Proposal;
    expect(rolled.status).toBe('ROLLED_BACK');
    const after = (await request(app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'POST /charges', payload: renamed })).body as { data: { ok: boolean; applied: unknown } };
    expect(after.data.applied).toBeNull();
    expect(after.data.ok).toBe(false);
  });

  it('candidate versions stay separate: a dry run can use a proposal explicitly, the active path never does', async () => {
    const { proposal } = await proposedRename();
    const renamed = { payment_reference: 'txn_dry', amount: 5, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' };
    const dry = (await request(app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'POST /charges', payload: renamed, proposalId: proposal.id })).body as { data: { ok: boolean; applied: { status: string } } };
    expect(dry.data.ok).toBe(true);
    expect(dry.data.applied.status).toBe('CANDIDATE');
    const active = (await request(app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'POST /charges', payload: renamed })).body as { data: { ok: boolean; applied: unknown } };
    expect(active.data.ok).toBe(false);
    expect(active.data.applied).toBeNull();
    expect((t.proposalStore as InMemoryProposalStore).executions).toHaveLength(0); // dry runs are not persisted
  });

  it('validation blocks a proposal whose transform does not fit the live payloads', async () => {
    await approveBuiltins();
    // Finding: amount removed. Provider actually renamed transaction_id, so the amount->total rule will not fit real observations.
    const { findings } = await findingUnder('schema_rename', 'payments', false);
    const removed = findings.find((f) => f.rule === 'structural.field_removed')!;
    const out = (await post('/api/repairs/propose', { findingId: removed.id }, 201)).data as Propose;
    // Force the wrong rule by executing explicit payloads that lack payment_reference and then validating against observations with "total" absent.
    const wrong = (await post(`/api/repairs/${out.proposal.id}/execute`, { payloads: [{ amount: 1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }] })).data as Report;
    expect(wrong.executions[0]!.rejections.map((r) => r.code)).toEqual(['MISSING_FIELD']);
    // Replace the finding's observations with legacy payloads so validation sees conflicts: activate baseline scenario and probe with old shape, then validate against a fixture that is designed to fail.
    const spec = BUILTIN_REPAIR_RULES[0]!;
    const brokenSpec = { ...spec, key: 'payments.charges.broken-fixture', fixtures: [{ name: 'should pass but will not', payload: { payment_reference: null, amount: 1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: false }] };
    const broken = (await post('/api/repair-rules', { spec: brokenSpec, createdBy: 'alice' }, 201)).data as { id: string };
    await post(`/api/repair-rules/${broken.id}/approve`, { approvedBy: 'bob' });
    const rs = t.ruleStore as InMemoryRuleStore;
    // Flip the fixture expectation after registration to simulate drift between rule and reality.
    const row = rs.rows.find((r) => r.key === 'payments.charges.broken-fixture')!;
    row.spec.fixtures[0]!.expectOk = true;
    // Retire the original so the broken rule is selected.
    const orig = rs.rows.find((r) => r.key === spec.key)!;
    await post(`/api/repair-rules/${orig.id}/retire`, { actor: 'bob' });
    const out2 = (await post('/api/repairs/propose', { findingId: removed.id }, 201)).data as Propose;
    expect(out2.proposal.ruleKey).toBe('payments.charges.broken-fixture');
    const v = (await post(`/api/repairs/${out2.proposal.id}/validate`, { executedBy: 'alice' })).data as Report;
    expect(v.status).toBe('BLOCKED');
    expect(v.blockedReason).toMatch(/replay.*unexpected/);
    await post(`/api/repairs/${out2.proposal.id}/review`, { decision: 'approve', reviewer: 'bob' }, 409);
    const report = (await request(app).get(`/api/repairs/${out2.proposal.id}/report`)).body as { data: { summary: { failed: number; rejectionCodes: Record<string, number> }; version: { status: string } } };
    expect(report.data.version.status).toBe('FAILED');
    expect(report.data.summary.rejectionCodes['NULL_VALUE']).toBe(1);
  });
});
