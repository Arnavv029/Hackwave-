import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '../../src/db/client.js';
import { PrismaObservationStore } from '../../src/observation/store.js';
import { PrismaBaselineStore, PrismaFindingStore } from '../../src/detection/stores.js';
import { createTestPrisma, DB_TESTS_ENABLED, truncateAll } from '../setup/db.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

describe.skipIf(!DB_TESTS_ENABLED)('baselines and findings (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let t: TestApp;
  const op = { authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
  const charge = { provider: 'payments', endpoint: 'createCharge', body: { amount: 500, currency: 'EUR', source_token: 'tok_x' } };
  const cfg = { minSamplesForBaseline: 3, window: { size: 10, minSamples: 4 } };

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
    t = buildTestApp({ store: new PrismaObservationStore(prisma), baselineStore: new PrismaBaselineStore(prisma), findingStore: new PrismaFindingStore(prisma), timeoutMs: 400 });
    await t.listen();
  });

  const probe = async () => {
    const res = await request(t.app).post('/api/probes').send(charge);
    expect(res.status).toBe(201);
    return res.body as { data: { id: string }; detection: { evaluated: boolean; findings: Array<{ id: string; rule: string; occurrenceCount: number }> } };
  };
  const post = async (path: string, body: Record<string, unknown>, expectStatus: number) => {
    const res = await request(t.app).post(path).set(op).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(expectStatus);
    return (res.body as { data: { id: string; version: number; status: string } }).data;
  };

  it('persists the lifecycle with audit events and supersedes atomically', async () => {
    for (let i = 0; i < 3; i += 1) await probe();
    const v1 = await post('/api/baselines', { provider: 'payments', endpoint: 'createCharge', config: cfg, createdBy: 'alice' }, 201);
    await post(`/api/baselines/${v1.id}/submit`, { actor: 'alice' }, 200);
    await post(`/api/baselines/${v1.id}/review`, { decision: 'approve', reviewer: 'bob' }, 200);
    await post(`/api/baselines/${v1.id}/promote`, { actor: 'carol' }, 200);
    const v2 = await post('/api/baselines', { provider: 'payments', endpoint: 'createCharge', config: cfg, createdBy: 'alice' }, 201);
    await post(`/api/baselines/${v2.id}/submit`, { actor: 'alice' }, 200);
    await post(`/api/baselines/${v2.id}/review`, { decision: 'approve', reviewer: 'bob' }, 200);
    await post(`/api/baselines/${v2.id}/promote`, { actor: 'carol' }, 200);

    const rows = await prisma.baseline.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.status, r.providerKey, r.endpointKey])).toEqual([
      [1, 'SUPERSEDED', 'payments', 'POST /charges'],
      [2, 'ACTIVE', 'payments', 'POST /charges'],
    ]);
    expect(rows[0]?.supersededAt).toBeInstanceOf(Date);
    expect(rows[1]?.promotedBy).toBe('carol');
    const audit = await prisma.auditEvent.findMany({ where: { entityType: 'BASELINE', entityId: v1.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['baseline.drafted', 'baseline.submitted', 'baseline.approved', 'baseline.promoted']);
    expect(audit[2]?.actorId).toBe('bob');
    // Summary rows are untouched by transitions.
    const stored = await prisma.baseline.findUniqueOrThrow({ where: { id: v1.id } });
    expect((stored.summary as { sampleCount: number }).sampleCount).toBe(3);
  });

  it('persists deduplicated findings linked to baseline, node and observations, and honours FALSE_POSITIVE', async () => {
    for (let i = 0; i < 3; i += 1) await probe();
    const b = await post('/api/baselines', { provider: 'payments', endpoint: 'createCharge', config: cfg, createdBy: 'alice' }, 201);
    await post(`/api/baselines/${b.id}/submit`, { actor: 'alice' }, 200);
    await post(`/api/baselines/${b.id}/review`, { decision: 'approve', reviewer: 'bob' }, 200);
    await post(`/api/baselines/${b.id}/promote`, { actor: 'carol' }, 200);

    t.scenarioStore.activate('payments', 'schema_rename');
    const first = await probe();
    const second = await probe();
    const removed = second.detection.findings.find((f) => f.rule === 'structural.field_removed');
    expect(removed?.occurrenceCount).toBe(2);
    const row = await prisma.finding.findUniqueOrThrow({ where: { id: removed!.id }, include: { baseline: true, observation: true, node: true } });
    expect(row.baseline.version).toBe(1);
    expect(row.observation?.id).toBe(first.data.id);
    expect(row.observationIds).toEqual([first.data.id, second.data.id]);
    expect(row.node.key).toBe('payments:POST:/charges');
    expect(row.rule).toBe('structural.field_removed');
    expect(row.kind).toBe('STRUCTURAL');
    expect(await prisma.finding.count()).toBe(3);

    const fp = await request(t.app).patch(`/api/findings/${removed!.id}/status`).set(op).send({ status: 'FALSE_POSITIVE', actor: 'dana' });
    expect(fp.status).toBe(200);
    const third = await probe();
    expect(third.detection.findings.map((f) => f.id)).not.toContain(removed!.id);
    const after = await prisma.finding.findUniqueOrThrow({ where: { id: removed!.id } });
    expect(after).toMatchObject({ status: 'FALSE_POSITIVE', occurrenceCount: 3 });
    expect(await prisma.auditEvent.count({ where: { entityType: 'FINDING', action: 'finding.false_positive' } })).toBe(1);

    const list = await request(t.app).get('/api/findings?status=OPEN&provider=payments');
    expect((list.body as { page: { total: number } }).page.total).toBe(2);
  });
});
