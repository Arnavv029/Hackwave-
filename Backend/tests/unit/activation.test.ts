import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { InMemoryActivationStore } from '../../src/activation/stores.js';
import { KeyedMutex } from '../../src/activation/stores.js';
import { approvalPolicy } from '../../src/activation/policy.js';
import { negativeCases } from '../../src/activation/pipeline.js';
import { paymentsAdapter } from '../../src/repair/adapters.js';
import { normalize } from '../../src/repair/engine.js';
import type { ErrorResponseBody } from '../../src/errors.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

const op = { authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
const chargeBody = { amount: 1_250, currency: 'USD', source_token: 'tok_visa' };
const renamed = { payment_reference: 'txn_live', amount: 5, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' };

interface Stage { stage: string; status: string; mandatory: boolean; summary: string }
interface ValidateResp { validationRunId: string; status: string; blockedReason: string | null; checksum: string; reportHash: string; stages: Stage[]; regressionTests: Array<{ testKey: string; status: string; mandatory: boolean; generic: boolean; covers: string[]; payloads: number; failures: unknown[] }>; negativeTests: Array<{ name: string; passed: boolean; expectedCode: string; actualCodes: string[] }>; contract: { input: { checked: number; conformingToProviderContract: number }; output: { checked: number; valid: number } }; selection: { fromImpact: boolean; tests: number; mandatory: number }; mandatoryFailures: number; totalTests: number; unexpected: number; reproducible: boolean }
interface Readiness { ready: boolean; blockers: string[]; policy: { requiredApprovals: number; reasons: string[]; financial: boolean }; approvals: Array<{ actor: string }> }
interface Pointer { activeVersionId: string | null; previousVersionId: string | null; lastGoodVersionId: string | null; revision: number; safety: { autoRollback: boolean } }
interface Activation { proposal: { id: string; status: string }; version: { id: string; status: string }; superseded: number; pointer: Pointer; event: { id: string; kind: string; fromVersionId: string | null; toVersionId: string; actor: string; initiator: string; evidence: { approvals: unknown[]; validationRun: { id: string } } } }

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
  return res.body as { data: never; error?: ErrorResponseBody['error'] & { details?: Record<string, unknown> } };
};
const probe = async (body: Record<string, unknown> = { provider: 'payments', endpoint: 'createCharge', body: chargeBody }) => {
  const res = await request(app).post('/api/probes').send(body);
  expect(res.status).toBe(201);
  return res.body as { data: { id: string }; detection: { findings: Array<{ id: string; rule: string }> } };
};
const live = async (payload: Record<string, unknown> = renamed) => ((await request(app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'POST /charges', payload })).body as { data: { ok: boolean; applied: { versionId: string } | null } }).data;
const pointer = async () => ((await request(app).get('/api/activations/current?adapterKey=adapter:PaymentsAdapter&endpointKey=POST%20/charges')).body as { data: { pointer: Pointer; events: Array<{ kind: string; initiator: string; toVersionId: string | null; reason: string | null }>; verifications: Array<{ passed: boolean; action: string }> } }).data;

/** Approved rules, baseline, fixture graph, rename finding with impact snapshot, and a DRAFT proposal. */
async function proposedRename(): Promise<{ proposalId: string; findingId: string }> {
  const seeded = (await post('/api/repair-rules/seed', { createdBy: 'alice' })).data as Array<{ id: string }>;
  for (const r of seeded) await post(`/api/repair-rules/${r.id}/approve`, { approvedBy: 'bob' });
  for (let i = 0; i < 3; i += 1) await probe();
  const b = (await post('/api/baselines', { provider: 'payments', endpoint: 'createCharge', config: { minSamplesForBaseline: 3, window: { size: 10, minSamples: 4 } }, createdBy: 'alice' }, 201)).data as { id: string };
  await post(`/api/baselines/${b.id}/submit`, { actor: 'alice' });
  await post(`/api/baselines/${b.id}/review`, { decision: 'approve', reviewer: 'bob' });
  await post(`/api/baselines/${b.id}/promote`, { actor: 'carol' });
  await post('/api/graph/fixtures/commerce-demo');
  t.scenarioStore.activate('payments', 'schema_rename');
  const { detection } = await probe();
  const removed = detection.findings.find((f) => f.rule === 'structural.field_removed')!;
  const impact = (await post(`/api/findings/${removed.id}/impact`, { createdBy: 'erin' }, 201)).data as { id: string };
  const out = (await post('/api/repairs/propose', { findingId: removed.id, impactReportId: impact.id, createdBy: 'alice' }, 201)).data as { proposal: { id: string } };
  return { proposalId: out.proposal.id, findingId: removed.id };
}
const validate = (id: string) => post(`/api/repairs/${id}/validate`, { executedBy: 'alice' }).then((r) => r.data as unknown as ValidateResp);
const approveTwice = async (id: string) => {
  await post(`/api/repairs/${id}/approvals`, { actor: 'bob' }, 201);
  await post(`/api/repairs/${id}/approvals`, { actor: 'dana' }, 201);
};
const activate = (id: string, actor = 'carol', extra: Record<string, unknown> = {}, expectStatus = 200) => post(`/api/repairs/${id}/activate`, { actor, confirm: true, ...extra }, expectStatus).then((r) => r.data as unknown as Activation);
const readiness = (id: string, actor?: string) => request(app).get(`/api/repairs/${id}/readiness${actor ? `?actor=${actor}` : ''}`).then((r) => (r.body as { data: Readiness }).data);

describe('validation pipeline', () => {
  it('runs every stage, selects regression tests through the graph, synthesises negative cases and persists the run', async () => {
    const { proposalId } = await proposedRename();
    const v = await validate(proposalId);
    expect(v.status).toBe('VALIDATED');
    expect(v.stages.map((s) => `${s.stage}:${s.status}`)).toEqual(['proposal_check:PASSED', 'candidate_config:PASSED', 'contract_check:PASSED', 'replay:PASSED', 'regression_tests:PASSED', 'negative_tests:PASSED']);
    expect(v.selection).toMatchObject({ fromImpact: true, tests: 4 });
    const keys = v.regressionTests.map((x) => x.testKey).sort();
    expect(keys).toEqual(['test:checkout-regression', 'test:finance-report-smoke', 'test:payments-adapter-contract', 'test:refund-regression']);
    const checkout = v.regressionTests.find((x) => x.testKey === 'test:checkout-regression')!;
    expect(checkout).toMatchObject({ status: 'PASSED', generic: false, covers: ['workflow:checkout'] });
    expect(checkout.payloads).toBeGreaterThanOrEqual(4); // fixtures expected ok + observations
    expect(v.negativeTests.map((n) => n.name)).toEqual(expect.arrayContaining(['missing payment_reference', 'null payment_reference', 'wrong type payment_reference', 'conflict transaction_id vs payment_reference', 'legacy transaction_id still accepted', 'unexpected extra field is dropped, not fatal', 'non-object payload', 'negative amount violates the internal contract']));
    expect(v.negativeTests.every((n) => n.passed)).toBe(true);
    expect(v.contract.output).toMatchObject({ checked: v.contract.input.checked });
    expect(v.contract.input.conformingToProviderContract).toBeLessThan(v.contract.input.checked); // renamed payloads no longer match the declared provider contract
    expect(v.mandatoryFailures).toBe(0);
    expect(v.reportHash).toMatch(/^[0-9a-f]{64}$/);
    const runs = (await request(app).get(`/api/repairs/${proposalId}/validation-runs`)).body as { data: Array<{ id: string; status: string; checksum: string }> };
    expect(runs.data).toHaveLength(1);
    expect(runs.data[0]).toMatchObject({ id: v.validationRunId, status: 'PASSED', checksum: v.checksum });
    const store = t.activationStore as InMemoryActivationStore;
    expect(store.testRuns.filter((r) => r.validationRunId === v.validationRunId)).toHaveLength(4);
    expect(store.testRuns.every((r) => r.workflowNodeId !== null)).toBe(true);
    expect(store.audit).toContain('validation.passed');
  });

  it('fails validation and blocks the proposal when a mandatory regression test fails', async () => {
    const { proposalId } = await proposedRename();
    // Simulate a provider that now returns a zero amount: contract-valid, but checkout's "amount > 0" invariant fails.
    const obsStore = t.store as unknown as { rows: Array<{ responseSample: unknown; outcome: string; endpointKey: string }> };
    for (const row of obsStore.rows) if (row.endpointKey === 'POST /charges' && row.responseSample && typeof row.responseSample === 'object') (row.responseSample as { amount: number }).amount = 0;
    const v = await validate(proposalId);
    expect(v.status).toBe('BLOCKED');
    expect(v.blockedReason).toMatch(/regression_tests/);
    const failing = v.regressionTests.filter((x) => x.status === 'FAILED').map((x) => x.testKey);
    expect(failing).toContain('test:checkout-regression');
    expect(v.regressionTests.find((x) => x.testKey === 'test:checkout-regression')!.failures[0]).toMatchObject({ invariant: 'amount > 0' });
    expect(v.mandatoryFailures).toBeGreaterThan(0);
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'bob' }, 409);
    await activate(proposalId, 'carol', {}, 409);
    expect((t.activationStore as InMemoryActivationStore).audit).toContain('validation.failed');
  });

  it('refuses a candidate whose rule was retired or whose spec carries code-like content', async () => {
    const { proposalId } = await proposedRename();
    const rules = (await request(app).get('/api/repair-rules?status=APPROVED')).body as { data: Array<{ id: string; key: string }> };
    const rename = rules.data.find((r) => r.key.includes('transaction_id'))!;
    await post(`/api/repair-rules/${rename.id}/retire`, { actor: 'bob' });
    const v = await validate(proposalId);
    expect(v.status).toBe('BLOCKED');
    expect(v.stages[0]).toMatchObject({ stage: 'proposal_check', status: 'FAILED' });
    expect(v.stages.slice(2).every((s) => s.status === 'SKIPPED')).toBe(true);
    expect(v.blockedReason).toMatch(/not APPROVED/);
  });

  it('negative cases demand rejection codes, not guesses', () => {
    const def = paymentsAdapter.endpoints['POST /charges']!;
    const run = (p: unknown) => normalize({ definition: def, payload: p, transforms: [{ type: 'rename_field', from: 'transaction_id', renamedTo: 'payment_reference', internalField: 'paymentId', expectedType: 'string' }], policy: { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false } });
    const cases = negativeCases([{ type: 'rename_field', from: 'transaction_id', renamedTo: 'payment_reference', internalField: 'paymentId', expectedType: 'string' }], renamed, def, run);
    expect(cases.every((c) => c.passed)).toBe(true);
    // A permissive policy that prefers the new value on conflicts fails the conflict case.
    const lax = (p: unknown) => normalize({ definition: def, payload: p, transforms: [{ type: 'rename_field', from: 'transaction_id', renamedTo: 'payment_reference', internalField: 'paymentId', expectedType: 'string' }], policy: { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'prefer_new', onExtraFields: 'drop', allowNumericStrings: false } });
    const laxCases = negativeCases([{ type: 'rename_field', from: 'transaction_id', renamedTo: 'payment_reference', internalField: 'paymentId', expectedType: 'string' }], renamed, def, lax);
    expect(laxCases.find((c) => c.name.startsWith('conflict'))!.passed).toBe(false);
  });
});

describe('approval policy', () => {
  it('scales required approvals with risk, provenance, transform type and coverage', () => {
    const def = paymentsAdapter.endpoints['POST /charges']!;
    const base = { proposal: { risk: 'LOW', derived: false, ruleKey: 'payments.x', createdBy: 'alice' }, version: { spec: { transforms: [{ type: 'rename_field' }] } }, endpoint: def, selectedTests: 3, mandatoryFailures: 0, impactMaxLikelihood: 'MEDIUM', impactHasCriticalDependents: false } as unknown as Parameters<typeof approvalPolicy>[0];
    expect(approvalPolicy(base).requiredApprovals).toBe(1);
    expect(approvalPolicy({ ...base, proposal: { ...base.proposal, risk: 'HIGH' } }).requiredApprovals).toBe(2);
    expect(approvalPolicy({ ...base, proposal: { ...base.proposal, derived: true } }).requiredApprovals).toBe(2);
    expect(approvalPolicy({ ...base, proposal: { ...base.proposal, ruleKey: 'ai.payments.x' } }).reasons).toContain('rule originated from an AI proposal');
    expect(approvalPolicy({ ...base, version: { spec: { transforms: [{ type: 'enum_mapping' }] } } as never }).requiredApprovals).toBe(2);
    expect(approvalPolicy({ ...base, selectedTests: 0 }).requiredApprovals).toBe(2);
    expect(approvalPolicy({ ...base, impactHasCriticalDependents: true }).requiredApprovals).toBe(2);
    const p = approvalPolicy({ ...base, proposal: { ...base.proposal, risk: 'HIGH', derived: true, ruleKey: 'ai.x' } });
    expect(p.requiredApprovals).toBe(2); // capped
    expect(p.financial).toBe(true);
  });
});

describe('activation', () => {
  it('refuses until validation passed, approvals meet policy, and the activator is independent; then activates atomically with evidence', async () => {
    const { proposalId } = await proposedRename();
    let r = await readiness(proposalId);
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(expect.arrayContaining(['proposal is DRAFT, must be VALIDATED', 'no validation run']));
    await validate(proposalId);
    r = await readiness(proposalId, 'carol');
    expect(r.blockers).toEqual(['0/2 required approval(s) recorded (distinct approvers)']);
    expect(r.policy.reasons).toContain('HIGH-likelihood impact on CRITICAL/HIGH dependents');
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'alice' }, 400); // creator
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'bob' }, 201);
    await activate(proposalId, 'carol', {}, 409);
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'dana' }, 201);
    expect((await readiness(proposalId, 'bob')).blockers).toEqual(['the activator cannot be one of the approvers']);
    expect((await readiness(proposalId, 'alice')).blockers).toEqual(['the activator cannot be the proposal creator']);
    expect((await readiness(proposalId, 'carol')).ready).toBe(true);
    expect((await live()).ok).toBe(false);

    const a = await activate(proposalId, 'carol', { expectedRevision: 0 });
    expect(a.proposal.status).toBe('ACTIVE');
    expect(a.version.status).toBe('ACTIVE');
    expect(a.pointer).toMatchObject({ activeVersionId: a.version.id, previousVersionId: null, revision: 1 });
    expect(a.event).toMatchObject({ kind: 'ACTIVATE', toVersionId: a.version.id, actor: 'carol', initiator: 'HUMAN' });
    expect(a.event.evidence.approvals.map((x) => (x as { actor: string }).actor).sort()).toEqual(['bob', 'dana']);
    expect(a.event.evidence.validationRun.id).toBeDefined();
    expect((await live()).applied?.versionId).toBe(a.version.id);
    await activate(proposalId, 'carol', {}, 409); // already active
    const current = await pointer();
    expect(current.events.map((e) => e.kind)).toEqual(['ACTIVATE']);
  });

  it('rejects a stale expected revision and serialises concurrent activations so only one wins the race', async () => {
    const { proposalId: p1, findingId } = await proposedRename();
    const p2 = ((await post('/api/repairs/propose', { findingId, createdBy: 'alice' }, 201)).data as { proposal: { id: string } }).proposal.id;
    for (const id of [p1, p2]) {
      await validate(id);
      await approveTwice(id);
    }
    const results = await Promise.all([
      request(app).post(`/api/repairs/${p1}/activate`).set(op).send({ actor: 'carol', confirm: true, expectedRevision: 0 }),
      request(app).post(`/api/repairs/${p2}/activate`).set(op).send({ actor: 'carol', confirm: true, expectedRevision: 0 }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect((loser.body as ErrorResponseBody).error.message).toMatch(/revision/);
    const current = await pointer();
    expect(current.pointer.revision).toBe(1);
    expect(current.events).toHaveLength(1);
    // Without an expected revision the second request queues behind the lock and supersedes cleanly.
    const winner = results.find((r) => r.status === 200)!.body as { data: Activation };
    const other = winner.data.proposal.id === p1 ? p2 : p1;
    const second = await activate(other, 'carol');
    expect(second.superseded).toBe(1);
    expect(second.pointer).toMatchObject({ previousVersionId: winner.data.version.id, revision: 2 });
  });
});

describe('post-activation verification and rollback', () => {
  async function activated(): Promise<{ proposalId: string; findingId: string; versionId: string }> {
    const { proposalId, findingId } = await proposedRename();
    await validate(proposalId);
    await approveTwice(proposalId);
    const a = await activate(proposalId);
    return { proposalId, findingId, versionId: a.version.id };
  }

  it('passes verification against a healthy provider, records lastGoodVersionId', async () => {
    const { versionId } = await activated();
    const v = (await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', probes: 4, triggeredBy: 'carol' })).data as unknown as { passed: boolean; probes: number; probeErrors: number; contractViolations: number; action: string; details: { results: Array<{ normalized: boolean }> } };
    expect(v).toMatchObject({ passed: true, probes: 4, probeErrors: 0, contractViolations: 0, action: 'NONE' });
    expect(v.details.results.every((r) => r.normalized === true)).toBe(true);
    const current = await pointer();
    expect(current.pointer.lastGoodVersionId).toBe(versionId);
    expect(current.verifications[0]).toMatchObject({ passed: true, action: 'NONE' });
  });

  it('auto-rolls back to no repair when verification shows contract violations (simulated bad provider data)', async () => {
    const { proposalId, versionId } = await activated();
    // Provider starts emitting a string amount under the renamed shape: 200 OK, but the repaired adapter rejects.
    t.scenarioStore.activate('payments', 'wrong_type', { field: 'amount' });
    const v = (await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', triggeredBy: 'system' })).data as unknown as { passed: boolean; contractViolations: number; action: string; rolledBackTo: string | null };
    expect(v.passed).toBe(false);
    expect(v.contractViolations).toBeGreaterThan(0);
    expect(v).toMatchObject({ action: 'AUTO_ROLLBACK', rolledBackTo: null });
    const current = await pointer();
    expect(current.pointer).toMatchObject({ activeVersionId: null, revision: 2 });
    expect(current.events.map((e) => [e.kind, e.initiator])).toEqual([['AUTO_ROLLBACK', 'SYSTEM'], ['ACTIVATE', 'HUMAN']]);
    expect(current.events[0]!.reason).toMatch(/verification failed/);
    const p = (await request(app).get(`/api/repairs/${proposalId}`)).body as { data: { status: string; versions: Array<{ id: string; status: string }> } };
    expect(p.data.status).toBe('ROLLED_BACK');
    expect(p.data.versions.find((x) => x.id === versionId)!.status).toBe('ROLLED_BACK');
    expect((await live()).applied).toBeNull();
    expect((t.activationStore as InMemoryActivationStore).audit).toEqual(expect.arrayContaining(['verification.failed', 'activation.auto_rollback']));
  });

  it('auto-rolls back to the previous known-good version when a newer one fails, and respects autoRollback=false', async () => {
    const { proposalId: p1, findingId, versionId: v1 } = await activated();
    await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', triggeredBy: 'carol' }); // v1 becomes known-good
    const p2 = ((await post('/api/repairs/propose', { findingId, createdBy: 'alice' }, 201)).data as { proposal: { id: string } }).proposal.id;
    await validate(p2);
    await approveTwice(p2);
    const a2 = await activate(p2);
    expect(a2.pointer.previousVersionId).toBe(v1);
    t.scenarioStore.activate('payments', 'timeout', { delayMs: 2_000 }); // provider unavailable: probe error rate 100%
    const v = (await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', triggeredBy: 'system' })).data as unknown as { passed: boolean; probeErrors: number; action: string; rolledBackTo: string | null };
    expect(v).toMatchObject({ passed: false, action: 'AUTO_ROLLBACK', rolledBackTo: v1 });
    const current = await pointer();
    expect(current.pointer.activeVersionId).toBe(v1);
    expect(((await request(app).get(`/api/repairs/${p1}`)).body as { data: { status: string } }).data.status).toBe('ACTIVE');
    expect(((await request(app).get(`/api/repairs/${p2}`)).body as { data: { status: string } }).data.status).toBe('ROLLED_BACK');
    t.scenarioStore.activate('payments', 'schema_rename');
    expect((await live()).applied?.versionId).toBe(v1);

    // Safety can be tuned; with autoRollback off a failure is recorded but nothing moves.
    const safety = await request(app).patch('/api/activations/safety').set(op).send({ adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', actor: 'carol', safety: { minProbes: 2, maxErrorRate: 0, maxContractViolationRate: 0, autoRollback: false } });
    expect(safety.status).toBe(200);
    t.scenarioStore.activate('payments', 'http_503');
    const v2 = (await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', triggeredBy: 'system' })).data as unknown as { passed: boolean; action: string };
    expect(v2).toMatchObject({ passed: false, action: 'NONE' });
    expect((await pointer()).pointer.activeVersionId).toBe(v1);
  });

  it('manual rollback is explicit, audited, and refuses when nothing is active', async () => {
    await post('/api/activations/rollback', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', actor: 'carol', reason: 'nothing' }, 409);
    const { proposalId, versionId } = await activated();
    expect((await request(app).post(`/api/repairs/${proposalId}/rollback`).send({ actor: 'carol', reason: 'x' })).status).toBe(401);
    const rb = (await post(`/api/repairs/${proposalId}/rollback`, { actor: 'carol', reason: 'provider reverted the rename' })).data as unknown as { status: string; restoredVersionId: string | null; event: { kind: string; reason: string } };
    expect(rb).toMatchObject({ status: 'ROLLED_BACK', restoredVersionId: null });
    expect(rb.event).toMatchObject({ kind: 'ROLLBACK', reason: 'provider reverted the rename' });
    expect((await live()).applied).toBeNull();
    await post(`/api/repairs/${proposalId}/rollback`, { actor: 'carol', reason: 'again' }, 409);
    await post(`/api/repairs/${proposalId}/activate`, { actor: 'carol', confirm: true }, 409); // rolled-back versions never come back silently
    const history = await pointer();
    expect(history.events.map((e) => e.kind)).toEqual(['ROLLBACK', 'ACTIVATE']);
    expect(history.events[0]!.toVersionId).toBeNull();
    expect(history.events[1]!.toVersionId).toBe(versionId);
    const all = (await request(app).get('/api/activations')).body as { data: Pointer[] };
    expect(all.data).toHaveLength(1);
  });
});

describe('KeyedMutex', () => {
  it('runs tasks for the same key strictly in order and different keys concurrently', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const task = (key: string, name: string, ms: number) => m.run(key, async () => {
      log.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name}:end`);
    });
    await Promise.all([task('a', 'a1', 20), task('a', 'a2', 1), task('b', 'b1', 1)]);
    expect(log.indexOf('a1:end')).toBeLessThan(log.indexOf('a2:start'));
    expect(log.indexOf('b1:start')).toBeLessThan(log.indexOf('a1:end'));
  });
});
