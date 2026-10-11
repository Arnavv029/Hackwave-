/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON; shapes are asserted inline */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';
import { DEMO_CATALOG } from '../../src/mocks/demo.router.js';
import { STARTER_KEYS } from '../../src/routes/demo.js';

/** The showcase APIs really misbehave after `driftAfter` calls, and the monitor engine catches each failure type. */
describe('showcase problem APIs', () => {
  let app: TestApp;
  const op = { Authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
  beforeEach(async () => {
    app = buildTestApp();
    await app.listen();
    app.demoStore!.slowMs = 1_500; // keep the timeout case fast in tests
    app.demoStore!.driftAfterMs = 400; // drift quickly in tests
  });
  afterEach(async () => {
    await app.close();
  });

  it('serves healthy responses first and drifts a fixed time after the first call, however often it is called', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await request(app.app).get('/mock/demo/users/profile');
      expect(a.status).toBe(200);
      expect(a.body.name).toBe('Aman Gupta');
      expect(a.headers['x-demo-drifted']).toBe('false');
    }
    await new Promise((r) => setTimeout(r, 450));
    const d = await request(app.app).get('/mock/demo/users/profile');
    expect(d.headers['x-demo-drifted']).toBe('true');
    expect(d.body.name).toBeUndefined();
    expect(d.body.display_name).toBe('Aman Gupta');
    const index = await request(app.app).get('/mock/demo');
    const endpoints = index.body.endpoints as Array<{ key: string; mode: string; state: { calls: number; drifted: boolean; driftsAt: string | null } }>;
    expect(endpoints.find((e) => e.key === 'users-profile')?.state).toMatchObject({ calls: 6, drifted: true });
    expect(endpoints.find((e) => e.key === 'users-profile')?.state.driftsAt).toBeTruthy();
    // Healthy, broken and flaky endpoints ignore the clock.
    expect((await request(app.app).get('/mock/demo/health/ping')).body.status).toBe('ok');
    expect((await request(app.app).get('/mock/demo/legacy/export')).status).toBe(500);
    expect((await request(app.app).get('/mock/demo/v1/retired')).status).toBe(404);
    expect((await request(app.app).get('/mock/demo/status/html')).headers['content-type']).toMatch(/text\/html/);
    const f1 = await request(app.app).get('/mock/demo/gateway/flaky');
    const f2 = await request(app.app).get('/mock/demo/gateway/flaky');
    expect([f1.status, f2.status].sort()).toEqual([200, 502]);
  });

  it('registers the whole catalogue with mappings in one call and each endpoint produces its advertised detection', async () => {
    // Without `all` only the small starter set is registered, so the initial UI stays readable.
    const starter = await request(app.app).post('/api/demo/register-all').set(op).send({ actor: 'demo', intervalSec: 60 });
    expect(starter.status).toBe(201);
    expect((starter.body.data as Array<{ key: string }>).map((r) => r.key).sort()).toEqual([...STARTER_KEYS].sort());
    const reg = await request(app.app).post('/api/demo/register-all').set(op).send({ actor: 'demo', intervalSec: 60, all: true });
    expect(reg.status).toBe(201);
    expect(reg.body.data).toHaveLength(DEMO_CATALOG.length);
    // reports-slow answers within the test's shortened slowMs, so it is healthy here.
    const expectedHealth: Record<string, string> = { 'legacy-export': 'Failing', retired: 'Failing' };
    for (const r of reg.body.data as Array<{ key: string; created: boolean; health: string }>) {
      expect(r.created, r.key).toBe(!STARTER_KEYS.includes(r.key));
      if (r.key !== 'flaky-gateway') expect(r.health, r.key).toBe(expectedHealth[r.key] ?? 'Healthy');
    }
    // Idempotent.
    const again = await request(app.app).post('/api/demo/register-all').set(op).send({ actor: 'demo' });
    expect((again.body.data as Array<{ created: boolean }>).every((r) => !r.created)).toBe(true);

    const catalog = (await request(app.app).get('/api/demo/catalog')).body.data as { endpoints: Array<{ key: string; monitorId: string; url: string }> };
    const byKey = Object.fromEntries(catalog.endpoints.map((e) => [e.key, e]));
    for (const e of catalog.endpoints) {
      expect(e.monitorId).toBeTruthy();
      expect(e.url).toMatch(/\/mock\/demo\//);
      await request(app.app).post(`/api/demo/${e.key}/drift`).set(op);
    }
    // register-all took longer than the test drift window; the status-only (HTML) monitor is healthy without a baseline.
    const html = (await request(app.app).get(`/api/monitors/${byKey['status-html']!.monitorId}`)).body.data as { health: string; statusOnly: boolean; baselineApproved: boolean };
    expect(html).toMatchObject({ health: 'Healthy', statusOnly: true, baselineApproved: false });
    const check = async (key: string) => (await request(app.app).post(`/api/monitors/${byKey[key]!.monitorId}/check`).set(op).send({ actor: 'demo' })).body.data as { incidentId: string | null; proposalId: string | null; diff: { breaking: boolean; changes: Array<{ changeType: string; path: string; newPath: string | null }> } | null; check: { outcome: string; statusCode: number | null } };
    const incident = async (id: string) => (await request(app.app).get(`/api/incidents/${id}`)).body.data as { issueType: string; severity: string; affectedFeatures: Array<{ featureName: string }>; proposalId: string | null };
    const proposal = async (id: string) => (await request(app.app).get(`/api/proposals/${id}`)).body.data as { requiresManualReview: boolean; transform: { ops: Array<{ op: string }> } };

    // rename -> auto-repairable rename proposal
    let r = await check('users-profile');
    expect(r.diff?.changes.some((c) => c.changeType === 'renamed' && c.path === 'name' && c.newPath === 'display_name')).toBe(true);
    const inc = await incident(r.incidentId!);
    expect(inc.affectedFeatures.map((f) => f.featureName)).toContain('Profile card');
    expect((await proposal(r.proposalId!)).transform.ops[0]?.op).toBe('rename');

    // type change -> coerce ops
    r = await check('inventory-stock');
    expect(r.diff?.changes.filter((c) => c.changeType === 'type_mismatch').map((c) => c.path).sort()).toEqual(['items[].price', 'items[].quantity']);
    expect((await proposal(r.proposalId!)).transform.ops.map((o) => o.op)).toEqual(['coerce', 'coerce']);
    expect((await incident(r.incidentId!)).issueType).toBe('Type changed');

    // field removed -> manual review
    r = await check('catalog-products');
    expect(r.diff?.changes.filter((c) => c.changeType === 'removed').map((c) => c.path).sort()).toEqual(['products[].currency', 'products[].dimensions.weight_kg']);
    expect((await proposal(r.proposalId!)).requiresManualReview).toBe(true);
    expect((await incident(r.incidentId!)).severity).toBe('Critical');

    // nested container rename -> one folded rename
    r = await check('geo-location');
    expect(r.diff?.changes.filter((c) => c.changeType === 'renamed')).toHaveLength(1);
    expect(r.diff?.changes.find((c) => c.changeType === 'renamed')).toMatchObject({ path: 'coords', newPath: 'coordinates' });
    expect((await proposal(r.proposalId!)).requiresManualReview).toBe(true);

    // pagination -> data->items rename plus removed page fields
    r = await check('orders-recent');
    expect(r.diff?.changes.some((c) => c.changeType === 'renamed' && c.path === 'data' && c.newPath === 'items')).toBe(true);
    expect(r.diff?.changes.some((c) => c.changeType === 'removed' && c.path === 'page')).toBe(true);

    // mixed -> removed currency, added balance_cents, nullable balance is not a type change
    r = await check('wallet-balance');
    expect(r.diff?.changes.map((c) => `${c.changeType}:${c.path}`)).toEqual(expect.arrayContaining(['removed:currency', 'added:balance_cents']));
    expect(r.diff?.changes.some((c) => c.changeType === 'type_mismatch')).toBe(false);

    // value change only -> no incident, non-breaking
    r = await check('weather-current');
    expect(r.diff?.breaking).toBe(false);
    expect(r.incidentId).toBeNull();
    expect(r.diff?.changes.some((c) => c.changeType === 'value_changed' && c.path === 'unit')).toBe(true);

    // availability cases
    r = await check('auth-session');
    expect(r.check.outcome).toBe('UNAVAILABLE');
    expect((await incident(r.incidentId!)).issueType).toBe('HTTP error');
    expect(r.proposalId).toBeNull();
    r = await check('search-suggest');
    expect(r.check.outcome).toBe('RATE_LIMITED');
    r = await check('feed-latest');
    expect(r.check.outcome).toBe('MALFORMED_RESPONSE');
    expect(r.incidentId).toBeTruthy();

    // timeout (monitor timeout lowered below the slow delay)
    await request(app.app).patch(`/api/monitors/${byKey['notifications-status']!.monitorId}`).set(op).send({ timeoutMs: 500, actor: 'demo' });
    r = await check('notifications-status');
    expect(r.check.outcome).toBe('TIMEOUT');
    expect(r.check.statusCode).toBeNull();
    expect((await incident(r.incidentId!)).issueType).toBe('Timeout');

    // restore -> incidents resolve
    await request(app.app).post('/api/demo/auth-session/restore').set(op);
    const healed = (await request(app.app).post(`/api/monitors/${byKey['auth-session']!.monitorId}/check`).set(op).send({ actor: 'demo' })).body.data as { resolvedIncidents: string[]; monitor: { health: string } };
    expect(healed.resolvedIncidents).toHaveLength(1);
    expect(healed.monitor.health).toBe('Healthy');

    // reset counters
    expect((await request(app.app).post('/api/demo/reset').set(op).send({ driftAfterSec: 5 })).body.data.driftAfterMs).toBe(5000);
    expect((await request(app.app).post('/api/demo/users-profile/drift')).status).toBe(401);
  }, 30_000);
});
