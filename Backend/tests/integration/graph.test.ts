import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '../../src/db/client.js';
import { PrismaObservationStore } from '../../src/observation/store.js';
import { PrismaBaselineStore, PrismaFindingStore } from '../../src/detection/stores.js';
import { PrismaGraphStore, PrismaImpactReportStore } from '../../src/graph/stores.js';
import type { ImpactReportBody } from '../../src/graph/service.js';
import { createTestPrisma, DB_TESTS_ENABLED, truncateAll } from '../setup/db.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

describe.skipIf(!DB_TESTS_ENABLED)('graph and impact (PostgreSQL)', () => {
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
    await t?.close();
    t = buildTestApp({
      store: new PrismaObservationStore(prisma),
      baselineStore: new PrismaBaselineStore(prisma),
      findingStore: new PrismaFindingStore(prisma),
      graphStore: new PrismaGraphStore(prisma),
      impactReportStore: new PrismaImpactReportStore(prisma),
      timeoutMs: 400,
    });
    await t.listen();
  });

  it('merges the fixture with observation-created nodes and persists an impact report linked to the finding', async () => {
    for (let i = 0; i < 3; i += 1) expect((await request(t.app).post('/api/probes').send(charge)).status).toBe(201);
    const opBefore = await prisma.dependencyNode.findUniqueOrThrow({ where: { key: 'payments:POST:/charges' } });
    expect((await request(t.app).post('/api/graph/fixtures/commerce-demo').set(op)).status).toBe(200);
    const opAfter = await prisma.dependencyNode.findUniqueOrThrow({ where: { key: 'payments:POST:/charges' } });
    expect(opAfter.id).toBe(opBefore.id); // upsert by key kept the observation's node
    expect(await prisma.dependencyEdge.count({ where: { sourceId: opAfter.id, relation: 'NORMALIZES' } })).toBe(1);
    const observedExposes = await prisma.dependencyEdge.findFirstOrThrow({ where: { targetId: opAfter.id, relation: 'EXPOSES' } });
    expect(observedExposes.provenance).toBe('OBSERVED');

    const b = (await request(t.app).post('/api/baselines').set(op).send({ provider: 'payments', endpoint: 'createCharge', config: { minSamplesForBaseline: 3 }, createdBy: 'alice' })).body as { data: { id: string } };
    await request(t.app).post(`/api/baselines/${b.data.id}/submit`).set(op).send({ actor: 'alice' });
    await request(t.app).post(`/api/baselines/${b.data.id}/review`).set(op).send({ decision: 'approve', reviewer: 'bob' });
    await request(t.app).post(`/api/baselines/${b.data.id}/promote`).set(op).send({ actor: 'carol' });
    t.scenarioStore.activate('payments', 'schema_rename');
    const probe = (await request(t.app).post('/api/probes').send(charge)).body as { detection: { findings: Array<{ id: string; rule: string }> } };
    const removed = probe.detection.findings.find((f) => f.rule === 'structural.field_removed')!;

    const saved = await request(t.app).post(`/api/findings/${removed.id}/impact`).set(op).send({ createdBy: 'erin' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const { id, report } = (saved.body as { data: { id: string; report: ImpactReportBody } }).data;
    expect(report.dependents[0]!.node.key).toBe('adapter:PaymentsAdapter');
    expect(report.tests.length).toBe(4);

    const row = await prisma.impactReport.findUniqueOrThrow({ where: { id }, include: { finding: true } });
    expect(row.finding?.id).toBe(removed.id);
    expect(row.nodeId).toBe(opAfter.id);
    expect(row).toMatchObject({ dependentCount: report.summary.dependents, testCount: 4, maxLikelihood: 'HIGH', truncated: false, createdBy: 'erin' });
    expect((row.report as unknown as ImpactReportBody).changedDependency.endpointKey).toBe('POST /charges');
  });

  it('enforces graph constraints in SQL and cascades deletes through edges', async () => {
    expect((await request(t.app).post('/api/graph/fixtures/commerce-demo').set(op)).status).toBe(200);
    const edges = await prisma.dependencyEdge.count();
    const dup = await request(t.app).post('/api/graph/edges').set(op).send({ from: 'adapter:PaymentsAdapter', to: 'service:CheckoutService', relation: 'USES' });
    expect(dup.status).toBe(409);
    expect((await request(t.app).delete('/api/graph/nodes/adapter:PaymentsAdapter').set(op)).status).toBe(204);
    expect(await prisma.dependencyEdge.count()).toBe(edges - 5); // 2 NORMALIZES in, USES x2 out, COVERED_BY out
    const list = await request(t.app).get('/api/graph/nodes?kind=TEST&limit=2');
    expect((list.body as { page: { total: number; hasMore: boolean } }).page).toMatchObject({ total: 5, hasMore: true });
  });
});
