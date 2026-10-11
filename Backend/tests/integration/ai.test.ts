import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '../../src/db/client.js';
import { PrismaObservationStore } from '../../src/observation/store.js';
import { PrismaBaselineStore, PrismaFindingStore } from '../../src/detection/stores.js';
import { PrismaGraphStore, PrismaImpactReportStore } from '../../src/graph/stores.js';
import { PrismaProposalStore, PrismaRuleStore } from '../../src/repair/stores.js';
import { PrismaActivationStore } from '../../src/activation/stores.js';
import { PrismaAiProposalStore } from '../../src/ai/stores.js';
import type { MockProposalProvider } from '../../src/ai/provider.js';
import { createTestPrisma, DB_TESTS_ENABLED, truncateAll } from '../setup/db.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

describe.skipIf(!DB_TESTS_ENABLED)('AI proposals (PostgreSQL)', () => {
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
      aiStore: new PrismaAiProposalStore(prisma),
      timeoutMs: 400,
    });
    await t.listen();
  });

  const post = async (path: string, body: Record<string, unknown> = {}, expectStatus = 200) => {
    const res = await request(t.app).post(path).set(op).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(expectStatus);
    return res.body as { data: never };
  };

  it('persists versions, input references, model metadata and audit events; promotion creates a rule row', async () => {
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

    // Default mock behaviour derives a rename proposal from the report.
    const mock = t.aiProvider as MockProposalProvider;
    expect(mock.name).toBe('mock');
    const first = (await post('/api/ai/proposals', { findingId: removed.id, impactReportId: impact.id, createdBy: 'alice' }, 201)).data as { proposal: { id: string; status: string; version: number } };
    expect(first.proposal.status).toBe('PENDING_REVIEW');
    const second = (await post('/api/ai/proposals', { findingId: removed.id, createdBy: 'alice' }, 201)).data as { proposal: { id: string; version: number } };
    expect(second.proposal.version).toBe(2);

    const row = await prisma.aiProposal.findUniqueOrThrow({ where: { id: first.proposal.id }, include: { finding: true } });
    expect(row).toMatchObject({ status: 'PENDING_REVIEW', version: 1, provider: 'mock', model: 'mock-model', attempts: 1, requiresHumanReview: true, risk: 'HIGH' });
    expect(row.inputRefs).toMatchObject({ baselineId: b.id, baselineVersion: 1, impactReportId: impact.id });
    expect((row.proposal as { transformation: { type: string } }).transformation.type).toBe('rename_field');
    expect((row.compiledTransform as { internalField: string }).internalField).toBe('paymentId');
    expect(row.finding.id).toBe(removed.id);
    expect(JSON.stringify(row)).not.toContain('tok_x');

    const promoted = (await post(`/api/ai/proposals/${first.proposal.id}/promote`, { actor: 'bob' }, 201)).data as { rule: { id: string } };
    const rule = await prisma.repairRule.findUniqueOrThrow({ where: { id: promoted.rule.id } });
    expect(rule.status).toBe('DRAFT');
    expect(rule.createdBy).toBe('bob');
    expect((await prisma.aiProposal.findUniqueOrThrow({ where: { id: first.proposal.id } })).ruleId).toBe(rule.id);
    const actions = (await prisma.auditEvent.findMany({ where: { entityType: 'AI_PROPOSAL' }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['ai_proposal.pending_review', 'ai_proposal.pending_review', 'ai_proposal.promoted']);
    expect(await prisma.repairVersion.count({ where: { status: 'ACTIVE' } })).toBe(0); // nothing activated
  });
});
