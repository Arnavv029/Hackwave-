import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '../../src/db/client.js';
import { PrismaObservationStore } from '../../src/observation/store.js';
import { PrismaBaselineStore, PrismaFindingStore } from '../../src/detection/stores.js';
import { PrismaGraphStore, PrismaImpactReportStore } from '../../src/graph/stores.js';
import { PrismaProposalStore, PrismaRuleStore } from '../../src/repair/stores.js';
import { PrismaActivationStore } from '../../src/activation/stores.js';
import { createTestPrisma, DB_TESTS_ENABLED, truncateAll } from '../setup/db.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

describe.skipIf(!DB_TESTS_ENABLED)('activation lifecycle (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let t: TestApp;
  const op = { authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
  const charge = { provider: 'payments', endpoint: 'createCharge', body: { amount: 500, currency: 'EUR', source_token: 'tok_x' } };

  beforeAll(() => {
    prisma = createTestPrisma();
  });
  afterAll(async () => {
    await t?.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
    await prisma.repairRule.deleteMany();
    await prisma.adapterActivation.deleteMany();
    await prisma.activationEvent.deleteMany();
    await prisma.repairValidationRun.deleteMany();
    await prisma.repairApproval.deleteMany();
    await t?.close();
    t = buildTestApp({
      store: new PrismaObservationStore(prisma),
      baselineStore: new PrismaBaselineStore(prisma),
      findingStore: new PrismaFindingStore(prisma),
      graphStore: new PrismaGraphStore(prisma),
      impactReportStore: new PrismaImpactReportStore(prisma),
      ruleStore: new PrismaRuleStore(prisma),
      proposalStore: new PrismaProposalStore(prisma),
      activationStore: new PrismaActivationStore(prisma),
      timeoutMs: 400,
    });
    await t.listen();
  });

  const post = async (path: string, body: Record<string, unknown> = {}, expectStatus = 200) => {
    const res = await request(t.app).post(path).set(op).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(expectStatus);
    return res.body as { data: never };
  };

  async function proposed(): Promise<{ proposalId: string; findingId: string }> {
    const seeded = (await post('/api/repair-rules/seed', { createdBy: 'alice' })).data as Array<{ id: string }>;
    for (const r of seeded) await post(`/api/repair-rules/${r.id}/approve`, { approvedBy: 'bob' });
    for (let i = 0; i < 3; i += 1) expect((await request(t.app).post('/api/probes').send(charge)).status).toBe(201);
    const b = (await post('/api/baselines', { provider: 'payments', endpoint: 'createCharge', config: { minSamplesForBaseline: 3 }, createdBy: 'alice' }, 201)).data as { id: string };
    await post(`/api/baselines/${b.id}/submit`, { actor: 'alice' });
    await post(`/api/baselines/${b.id}/review`, { decision: 'approve', reviewer: 'bob' });
    await post(`/api/baselines/${b.id}/promote`, { actor: 'carol' });
    await post('/api/graph/fixtures/commerce-demo');
    t.scenarioStore.activate('payments', 'schema_rename');
    const probe = (await request(t.app).post('/api/probes').send(charge)).body as { detection: { findings: Array<{ id: string; rule: string }> } };
    const removed = probe.detection.findings.find((f) => f.rule === 'structural.field_removed')!;
    const impact = (await post(`/api/findings/${removed.id}/impact`, { createdBy: 'erin' }, 201)).data as { id: string };
    const out = (await post('/api/repairs/propose', { findingId: removed.id, impactReportId: impact.id, createdBy: 'alice' }, 201)).data as { proposal: { id: string } };
    return { proposalId: out.proposal.id, findingId: removed.id };
  }

  it('success path: validation run + test runs + approvals + pointer + event + verification are all persisted', async () => {
    const { proposalId } = await proposed();
    const v = (await post(`/api/repairs/${proposalId}/validate`, { executedBy: 'alice' })).data as { validationRunId: string; status: string };
    expect(v.status).toBe('VALIDATED');
    const run = await prisma.repairValidationRun.findUniqueOrThrow({ where: { id: v.validationRunId } });
    expect(run.status).toBe('PASSED');
    expect(await prisma.testRun.count({ where: { validationRunId: run.id } })).toBe(4);
    expect(await prisma.testRun.count({ where: { validationRunId: run.id, mandatory: true, status: 'PASSED' } })).toBeGreaterThan(0);
    await post(`/api/repairs/${proposalId}/activate`, { actor: 'carol', confirm: true }, 409);
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'bob' }, 201);
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'dana' }, 201);
    expect(await prisma.repairApproval.count({ where: { proposalId, decision: 'APPROVE' } })).toBe(2);
    const a = (await post(`/api/repairs/${proposalId}/activate`, { actor: 'carol', confirm: true })).data as { version: { id: string }; event: { id: string }; pointer: { revision: number } };
    const ptr = await prisma.adapterActivation.findUniqueOrThrow({ where: { adapterKey_endpointKey: { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges' } } });
    expect(ptr).toMatchObject({ activeVersionId: a.version.id, previousVersionId: null, revision: 1, updatedBy: 'carol' });
    const ev = await prisma.activationEvent.findUniqueOrThrow({ where: { id: a.event.id } });
    expect(ev).toMatchObject({ kind: 'ACTIVATE', actor: 'carol', initiator: 'HUMAN', toVersionId: a.version.id });
    expect((ev.evidence as { approvals: unknown[] }).approvals).toHaveLength(2);

    const verify = (await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', triggeredBy: 'carol' })).data as { passed: boolean; id: string };
    expect(verify.passed).toBe(true);
    expect(await prisma.verificationRun.count({ where: { activationEventId: a.event.id, passed: true } })).toBe(1);
    expect((await prisma.adapterActivation.findUniqueOrThrow({ where: { id: ptr.id } })).lastGoodVersionId).toBe(a.version.id);
    const actions = (await prisma.auditEvent.findMany({ where: { entityType: { in: ['VALIDATION_RUN', 'ACTIVATION', 'VERIFICATION_RUN'] } }, orderBy: { createdAt: 'asc' } })).map((x) => x.action);
    expect(actions).toEqual(['validation.passed', 'activation.activate', 'verification.passed']);
  });

  it('failed verification auto-rolls back and leaves the full history in place', async () => {
    const { proposalId } = await proposed();
    await post(`/api/repairs/${proposalId}/validate`, { executedBy: 'alice' });
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'bob' }, 201);
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'dana' }, 201);
    const a = (await post(`/api/repairs/${proposalId}/activate`, { actor: 'carol', confirm: true })).data as { version: { id: string } };
    t.scenarioStore.activate('payments', 'wrong_type', { field: 'amount' });
    const v = (await post('/api/activations/verify', { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', triggeredBy: 'system' })).data as { passed: boolean; action: string };
    expect(v).toMatchObject({ passed: false, action: 'AUTO_ROLLBACK' });
    const ptr = await prisma.adapterActivation.findUniqueOrThrow({ where: { adapterKey_endpointKey: { adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges' } } });
    expect(ptr).toMatchObject({ activeVersionId: null, revision: 2 });
    expect((await prisma.repairVersion.findUniqueOrThrow({ where: { id: a.version.id } })).status).toBe('ROLLED_BACK');
    const events = await prisma.activationEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.kind, e.initiator])).toEqual([['ACTIVATE', 'HUMAN'], ['AUTO_ROLLBACK', 'SYSTEM']]);
    expect(await prisma.auditEvent.count({ where: { action: 'activation.auto_rollback' } })).toBe(1);
    // Nothing was deleted: validation runs, approvals, executions and the first event all remain.
    expect(await prisma.repairValidationRun.count()).toBe(1);
    expect(await prisma.repairApproval.count()).toBe(2);
  });

  it('rejects activation when validation failed, even with approvals', async () => {
    const { proposalId } = await proposed();
    await prisma.observation.updateMany({ where: { endpointKey: 'POST /charges', outcome: 'SUCCESS' }, data: { responseSample: { payment_reference: 'txn_zero', amount: 0, currency: 'EUR', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' } } });
    const v = (await post(`/api/repairs/${proposalId}/validate`, { executedBy: 'alice' })).data as { status: string; mandatoryFailures: number };
    expect(v.status).toBe('BLOCKED');
    expect(v.mandatoryFailures).toBeGreaterThan(0);
    await post(`/api/repairs/${proposalId}/approvals`, { actor: 'bob' }, 409);
    await post(`/api/repairs/${proposalId}/activate`, { actor: 'carol', confirm: true }, 409);
    expect(await prisma.activationEvent.count()).toBe(0);
  });
});
