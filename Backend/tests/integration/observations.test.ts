import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '../../src/db/client.js';
import { PrismaObservationStore } from '../../src/observation/store.js';
import { createTestPrisma, DB_TESTS_ENABLED, truncateAll } from '../setup/db.js';
import { buildTestApp, type TestApp } from '../setup/app.js';

/** Runs against PostgreSQL when RUN_DB_TESTS=1 (`npm run test:db`). */
describe.skipIf(!DB_TESTS_ENABLED)('observation persistence (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let t: TestApp;

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
    t = buildTestApp({ store: new PrismaObservationStore(prisma), resolveSecret: () => 'sk_live_dbsecret12345678', timeoutMs: 400 });
    await t.listen();
  });

  const probe = (body: Record<string, unknown>) => request(t.app).post('/api/probes').send(body);
  const charge = { provider: 'payments', endpoint: 'createCharge', body: { amount: 500, currency: 'EUR', source_token: 'tok_x' } };

  it('persists observations, links them to upserted provider/operation nodes, and never stores secrets', async () => {
    const res = await probe({ ...charge, correlationId: 'db-1' });
    expect(res.status).toBe(201);
    const id = (res.body as { data: { id: string } }).data.id;

    const row = await prisma.observation.findUniqueOrThrow({ where: { id }, include: { node: { include: { parent: true } } } });
    expect(row).toMatchObject({ providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', statusCode: 201, outcome: 'SUCCESS', errorCategory: null, parseOutcome: 'JSON', correlationId: 'db-1', scenario: 'baseline' });
    expect(row.node.kind).toBe('OPERATION');
    expect(row.node.key).toBe('payments:POST:/charges');
    expect(row.node.parent?.key).toBe('payments');
    expect(row.node.parent?.secretRef).toBe('PAYMENTS_API_KEY');
    expect(await prisma.dependencyEdge.count({ where: { relation: 'EXPOSES' } })).toBe(1);
    expect(JSON.stringify(row)).not.toContain('dbsecret');
    expect(JSON.stringify(row)).not.toContain('session-secret');

    // Probing again reuses the nodes.
    await probe(charge);
    expect(await prisma.dependencyNode.count()).toBe(2);
    expect(await prisma.observation.count()).toBe(2);
  });

  it('stores null status for timeouts and computes shape deltas against the previous JSON observation', async () => {
    const first = await probe(charge);
    t.scenarioStore.activate('payments', 'schema_rename');
    const renamed = await probe(charge);
    t.scenarioStore.activate('payments', 'timeout');
    const timedOut = await probe(charge);

    const rows = await prisma.observation.findMany({ orderBy: { observedAt: 'asc' } });
    expect(rows.map((r) => r.statusCode)).toEqual([201, 201, null]);
    expect(rows[2]?.outcome).toBe('TIMEOUT');
    expect(rows[2]?.errorCategory).toBe('TIMEOUT');
    expect(rows[1]?.shapeDelta).toMatchObject({ comparedTo: (first.body as { data: { id: string } }).data.id, removed: ['transaction_id'], added: ['payment_reference'] });
    expect((renamed.body as { data: { contractCheck: { valid: boolean } } }).data.contractCheck.valid).toBe(false);
    expect((timedOut.body as { data: { shapeDelta: unknown } }).data.shapeDelta).toBeNull();
  });

  it('filters, sorts and paginates through SQL', async () => {
    await probe(charge);
    t.scenarioStore.activate('payments', 'rate_limited', { retryAfterSeconds: 2 });
    await probe({ ...charge, correlationId: 'rl' });
    t.scenarioStore.reset();
    await probe({ provider: 'shipping', endpoint: 'listShipments', query: { page: 1, size: 2 } });
    t.scenarioStore.activate('shipping', 'http_503');
    await probe({ provider: 'shipping', endpoint: 'getShipment', pathParams: { id: 'shp_1001' } });

    const get = async (qs: string) => {
      const res = await request(t.app).get(`/api/observations?${qs}`);
      expect(res.status, qs).toBe(200);
      return res.body as { data: Array<{ outcome: string; endpointKey: string }>; page: { total: number; hasMore: boolean } };
    };
    expect((await get('')).page.total).toBe(4);
    expect((await get('provider=shipping')).page.total).toBe(2);
    expect((await get('status=429')).data[0]?.outcome).toBe('RATE_LIMITED');
    expect((await get('errorCategory=UNAVAILABLE')).data[0]?.endpointKey).toBe('GET /shipments/:id');
    expect((await get('correlationId=rl')).page.total).toBe(1);
    expect((await get('method=GET&outcome=SUCCESS')).page.total).toBe(1);
    const page = await get('limit=2&offset=2&sort=asc');
    expect(page.data).toHaveLength(2);
    expect(page.page.hasMore).toBe(false);
    expect(page.data.map((o) => o.endpointKey)).toEqual(['GET /shipments', 'GET /shipments/:id']);
    const old = await get(`to=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`);
    expect(old.page.total).toBe(0);
  });
});
