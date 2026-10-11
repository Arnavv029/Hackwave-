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

describe.skipIf(!DB_TESTS_ENABLED)('repair engine (PostgreSQL)', () => {
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

  it('persists rules, proposals, versions, executions and audit events through the full lifecycle', async () => {
    const seeded = (await post('/api/repair-rules/seed', { createdBy: 'alice' })).data as Array<{ id: string; key: string }>;
    expect(seeded).toHaveLength(3);
    expect((await post('/api/repair-rules/seed', { createdBy: 'alice' })).data).toEqual([]); // idempotent
    for (const r of seeded) await post(`/api/repair-rules/${r.id}/approve`, { approvedBy: 'bob' });
    expect(await prisma.repairRule.count({ where: { status: 'APPROVED' } })).toBe(3);
    const byProvider = await request(t.app).get('/api/repair-rules?provider=shipping');
    expect((byProvider.body as { page: { total: number } }).page.total).toBe(1);

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

    const proposed = (await post('/api/repairs/propose', { findingId: removed.id, impactReportId: impact.id, createdBy: 'alice' }, 201)).data as { proposal: { id: string; impactReportId: string }; version: { id: string; checksum: string } };
    expect(proposed.proposal.impactReportId).toBe(impact.id);
    const validated = (await post(`/api/repairs/${proposed.proposal.id}/validate`, { executedBy: 'alice', recentObservations: 5 })).data as { status: string; total: number };
    expect(validated.status).toBe('VALIDATED');
    expect(validated.total).toBeGreaterThanOrEqual(4); // 3 fixtures + >=1 successful observation
    await post(`/api/repairs/${proposed.proposal.id}/review`, { decision: 'approve', reviewer: 'bob' });
    await post(`/api/repairs/${proposed.proposal.id}/approvals`, { actor: 'dana' }, 201);
    await post(`/api/repairs/${proposed.proposal.id}/activate`, { actor: 'carol', confirm: true });

    const row = await prisma.repairProposal.findUniqueOrThrow({ where: { id: proposed.proposal.id }, include: { versions: true, executions: true, finding: true } });
    expect(row).toMatchObject({ status: 'ACTIVE', kind: 'FIELD_MAPPING', ruleKey: 'payments.charges.transaction_id-to-payment_reference', ruleVersion: 1, adapterKey: 'adapter:PaymentsAdapter', endpointKey: 'POST /charges', reviewedBy: 'dana' }); // last approver
    expect(row.versions[0]).toMatchObject({ version: 1, status: 'ACTIVE', checksum: proposed.version.checksum });
    expect(row.executions.length).toBe(validated.total);
    // Only the fixture that is declared to fail (conflicting values) is not ok.
    const notOk = row.executions.filter((e) => !e.ok);
    expect(notOk).toHaveLength(1);
    expect(notOk[0]).toMatchObject({ source: 'FIXTURE', rejections: [expect.objectContaining({ code: 'CONFLICTING_VALUES' })] });
    expect(row.executions.filter((e) => e.source === 'OBSERVATION').every((e) => e.ok)).toBe(true);
    expect(row.finding.id).toBe(removed.id);
    const actions = (await prisma.auditEvent.findMany({ where: { entityType: { in: ['REPAIR_RULE', 'REPAIR_PROPOSAL', 'REPAIR_VERSION', 'REPAIR_EXECUTION'] } }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions.filter((a) => a === 'rule.registered')).toHaveLength(3);
    expect(actions.filter((a) => a === 'rule.approved')).toHaveLength(3);
    expect(actions).toEqual(expect.arrayContaining(['repair.proposed', 'repair.validating', 'repair.executed', 'repair.validated', 'repair.approved', 'repair.activated']));

    // Runtime path reads the ACTIVE version from SQL.
    const live = await request(t.app).post('/api/adapters/adapter:PaymentsAdapter/normalize').send({ endpointKey: 'POST /charges', payload: { payment_reference: 'txn_db', amount: 1, currency: 'EUR', status: 'pending', created_at: '2026-10-11T00:00:00.000Z' } });
    expect((live.body as { data: { ok: boolean; applied: { versionId: string } } }).data).toMatchObject({ ok: true, applied: { versionId: proposed.version.id } });

    // A second proposal for the same endpoint supersedes the first on activation.
    const second = (await post('/api/repairs/propose', { findingId: removed.id, createdBy: 'alice' }, 201)).data as { proposal: { id: string } };
    await post(`/api/repairs/${second.proposal.id}/validate`, { executedBy: 'alice' });
    await post(`/api/repairs/${second.proposal.id}/review`, { decision: 'approve', reviewer: 'bob' });
    await post(`/api/repairs/${second.proposal.id}/approvals`, { actor: 'dana' }, 201);
    const act = (await post(`/api/repairs/${second.proposal.id}/activate`, { actor: 'carol', confirm: true })).data as { superseded: number };
    expect(act.superseded).toBe(1);
    expect(await prisma.repairVersion.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect((await prisma.repairProposal.findUniqueOrThrow({ where: { id: proposed.proposal.id } })).status).toBe('ROLLED_BACK');
  });
});
