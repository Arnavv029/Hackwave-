/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON; shapes are asserted inline */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp, TEST_CONTROL_TOKEN, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

/**
 * End-to-end monitor flow against the mock Payments provider served by the
 * same test server: register URL -> first response becomes the baseline ->
 * provider renames a field -> diff -> incident with affected feature ->
 * proposal -> validation -> approve -> promote -> incident auto-resolves.
 */
describe('API Guardian monitor flow', () => {
  let app: TestApp;
  let baseUrl: string;
  const op = { Authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
  const ctl = { Authorization: `Bearer ${TEST_CONTROL_TOKEN}` };

  beforeEach(async () => {
    app = buildTestApp();
    ({ baseUrl } = await app.listen());
    baseUrl = baseUrl.replace(/\/mock$/, '');
  });
  afterEach(async () => {
    await app.close();
  });

  const charge = { amount: 1250, currency: 'USD', source_token: 'tok_demo', idempotency_key: 'guardian-test' };

  it('registers a URL, baselines it, detects a rename, proposes, validates, promotes and heals', async () => {
    // Register (first check runs immediately and auto-approves the baseline).
    const created = await request(app.app).post('/api/monitors').set(op).send({ name: 'Payments charges', url: `${baseUrl}/mock/payments/charges`, method: 'POST', body: charge, intervalSec: 60, timeoutMs: 2000, environment: 'Staging', createdBy: 'alice' });
    expect(created.status).toBe(201);
    const m = created.body.data as { id: string; health: string; baselineApproved: boolean; baseline: { version: number; fieldCount: number } | null; lastStatusCode: number };
    expect(m.health).toBe('Healthy');
    expect(m.baselineApproved).toBe(true);
    expect(m.baseline?.version).toBe(1);
    expect(m.baseline?.fieldCount).toBeGreaterThan(3);
    expect(m.lastStatusCode).toBe(201);

    // Feature mapping on the field that is about to be renamed.
    const mapped = await request(app.app).post(`/api/monitors/${m.id}/mappings`).set(op).send({ feature: 'Checkout receipt', jsonPath: '$.transaction_id', route: '/checkout', impactLevel: 'Critical', createdBy: 'alice' });
    expect(mapped.status).toBe(201);

    // Healthy re-check: no incident.
    const ok = await request(app.app).post(`/api/monitors/${m.id}/check`).set(op).send({ actor: 'alice' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.diff.identical).toBe(true);
    expect(ok.body.data.incidentId).toBeNull();

    // Provider renames transaction_id -> payment_reference.
    expect((await request(app.app).post('/api/simulations/payments/schema_rename').set(ctl).send({})).status).toBe(200);
    const drift = await request(app.app).post(`/api/monitors/${m.id}/check`).set(op).send({ actor: 'alice' });
    expect(drift.status).toBe(200);
    expect(drift.body.data.diff.breaking).toBe(true);
    expect(drift.body.data.incidentId).toBeTruthy();
    expect(drift.body.data.proposalId).toBeTruthy();

    const inc = (await request(app.app).get(`/api/incidents/${drift.body.data.incidentId}`)).body.data as {
      status: string; issueType: string; severity: string; diffs: Array<{ changeType: string; path: string; newPath: string | null }>; affectedFeatures: Array<{ featureName: string; stillPresent: boolean }>; previousResponse: Record<string, unknown>; latestResponse: Record<string, unknown>; proposalId: string;
    };
    expect(inc.status).toBe('Open');
    expect(inc.severity).toBe('Critical');
    expect(inc.diffs.some((d) => d.changeType === 'renamed' && d.path === 'transaction_id' && d.newPath === 'payment_reference')).toBe(true);
    expect(inc.affectedFeatures[0]?.featureName).toBe('Checkout receipt');
    expect(inc.affectedFeatures[0]?.stillPresent).toBe(false);
    expect(inc.previousResponse['transaction_id']).toBeDefined();
    expect(inc.latestResponse['payment_reference']).toBeDefined();

    // Same drift again: deduplicated into the same incident.
    const again = await request(app.app).post(`/api/monitors/${m.id}/check`).set(op).send({ actor: 'alice' });
    expect(again.body.data.incidentId).toBe(drift.body.data.incidentId);
    expect((await request(app.app).get(`/api/incidents/${inc.proposalId ? drift.body.data.incidentId : ''}`)).body.data.occurrenceCount).toBe(2);

    // Monitor health is Review Needed (healthy HTTP, structural drift).
    expect((await request(app.app).get(`/api/monitors/${m.id}`)).body.data.health).toBe('Review Needed');

    // Proposal: declarative rename, validate, approve by someone else, promote.
    const prop = (await request(app.app).get(`/api/proposals/${inc.proposalId}`)).body.data as { status: string; transform: { ops: unknown[] }; adapterTransformation: string; requiresManualReview: boolean };
    expect(prop.status).toBe('Pending');
    expect(prop.requiresManualReview).toBe(false);
    expect(prop.transform.ops).toEqual([{ op: 'rename', from: '$.payment_reference', to: '$.transaction_id', removeSource: false, onConflict: 'reject' }]);
    expect(prop.adapterTransformation).not.toMatch(/function/);

    const notYet = await request(app.app).post(`/api/proposals/${inc.proposalId}/promote`).set(op).send({ actor: 'carol' });
    expect(notYet.status).toBe(409);

    const validated = await request(app.app).post(`/api/proposals/${inc.proposalId}/validate`).set(op).send({ actor: 'alice' });
    expect(validated.status).toBe(200);
    const vr = validated.body.data.validationResult as { status: string; assertions: Array<{ rule: string; passed: boolean }>; logs: string[] };
    expect(vr.status).toBe('Passed');
    expect(vr.assertions.find((a) => a.rule.includes('Checkout receipt'))?.passed).toBe(true);
    expect(vr.logs.some((l) => l.startsWith('[RESULT]'))).toBe(true);

    const approved = await request(app.app).post(`/api/proposals/${inc.proposalId}/approve`).set(op).send({ actor: 'bob' });
    expect(approved.body.data.status).toBe('Approved');
    const promoted = await request(app.app).post(`/api/proposals/${inc.proposalId}/promote`).set(op).send({ actor: 'carol' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.status).toBe('Promoted');
    expect(promoted.body.data.isActive).toBe(true);

    // The post-promotion check ran through the adapter: incident resolved, monitor healthy, check marked adapted.
    const after = (await request(app.app).get(`/api/incidents/${drift.body.data.incidentId}`)).body.data as { status: string; note: string };
    expect(after.status).toBe('Resolved');
    expect(after.note).toMatch(/adapter/);
    expect((await request(app.app).get(`/api/monitors/${m.id}`)).body.data.health).toBe('Healthy');
    const checks = (await request(app.app).get(`/api/monitors/${m.id}/checks`)).body.data as Array<{ adapted: boolean; diff: { identical: boolean; breaking: boolean; counts: { added: number; renamed: number; removed: number } } | null }>;
    expect(checks[0]?.adapted).toBe(true);
    // The adapter restores transaction_id and keeps the provider's payment_reference, so the only difference left is additive.
    expect(checks[0]?.diff?.breaking).toBe(false);
    expect(checks[0]?.diff?.counts).toMatchObject({ renamed: 0, removed: 0, added: 1 });

    // Audit trail covers the whole story.
    const audit = (await request(app.app).get('/api/audit')).body.data as Array<{ action: string; actorType: string }>;
    const actions = audit.map((a) => a.action);
    for (const expected of ['API dependency registered', 'Baseline approved', 'Feature mapping registered', 'Incident detected', 'Repair proposal created', 'Validation test executed', 'Repair proposal approved', 'Adapter promoted to gateway', 'Incident resolved']) expect(actions).toContain(expected);

    // Rollback restores the raw comparison and reopens the drift.
    const rolled = await request(app.app).post(`/api/monitors/${m.id}/adapter/rollback`).set(op).send({ actor: 'carol', reason: 'test rollback' });
    expect(rolled.status).toBe(200);
    expect(rolled.body.data.activeProposalId).toBeNull();
    expect(rolled.body.data.health).toBe('Review Needed');
  });

  it('opens an HTTP error incident on 503, resolves it when healthy again, and never exposes secrets', async () => {
    const created = await request(app.app).post('/api/monitors').set(op).send({ name: 'Shipments', url: `${baseUrl}/mock/shipping/shipments`, method: 'GET', intervalSec: 30, authType: 'BEARER', authSecret: 'sk-live-super-secret', createdBy: 'alice' });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('sk-live-super-secret');
    expect(created.body.data.hasSecret).toBe(true);
    const id = created.body.data.id as string;
    expect(created.body.data.health).toBe('Healthy');

    await request(app.app).post('/api/simulations/shipping/http_503').set(ctl).send({});
    const bad = await request(app.app).post(`/api/monitors/${id}/check`).set(op).send({ actor: 'alice' });
    expect(bad.body.data.check.outcome).toBe('UNAVAILABLE');
    const inc = (await request(app.app).get(`/api/incidents/${bad.body.data.incidentId}`)).body.data as { issueType: string; severity: string; latestResponse: unknown; previousResponse: unknown };
    expect(inc.issueType).toBe('HTTP error');
    expect(inc.severity).toBe('Critical');
    expect(inc.previousResponse).not.toBeNull();
    expect((await request(app.app).get(`/api/monitors/${id}`)).body.data.health).toBe('Failing');
    // No adapter proposal for availability incidents.
    expect((await request(app.app).post(`/api/incidents/${bad.body.data.incidentId}/proposals`).set(op).send({ actor: 'alice' })).status).toBe(422);

    await request(app.app).delete('/api/simulations/shipping').set(ctl);
    const good = await request(app.app).post(`/api/monitors/${id}/check`).set(op).send({ actor: 'alice' });
    expect(good.body.data.resolvedIncidents).toContain(bad.body.data.incidentId);
    expect((await request(app.app).get(`/api/monitors/${id}`)).body.data.health).toBe('Healthy');

    const all = JSON.stringify((await request(app.app).get('/api/audit')).body) + JSON.stringify((await request(app.app).get(`/api/monitors/${id}/checks`)).body);
    expect(all).not.toContain('sk-live-super-secret');
  });

  it('requires approval of the first baseline when autoBaseline is off, and blocks private URLs when the guard is on', async () => {
    const created = await request(app.app).post('/api/monitors').set(op).send({ name: 'Manual baseline', url: `${baseUrl}/mock/shipping/shipments`, autoBaseline: false, createdBy: 'alice' });
    expect(created.body.data.health).toBe('Review Needed');
    expect(created.body.data.baselineApproved).toBe(false);
    const pending = created.body.data.pendingBaseline as { id: string };
    const approved = await request(app.app).post(`/api/monitors/${created.body.data.id}/baselines/${pending.id}/approve`).set(op).send({ actor: 'bob' });
    expect(approved.body.data.status).toBe('APPROVED');
    expect((await request(app.app).get(`/api/monitors/${created.body.data.id}`)).body.data.health).toBe('Healthy');

    // Enable the SSRF guard: the loopback mock provider is now refused by a test connection.
    await request(app.app).put('/api/settings').set(op).send({ monitoring: { ssrfProtection: true }, actor: 'alice' });
    const test = await request(app.app).post('/api/monitors/test').set(op).send({ url: `${baseUrl}/mock/shipping/shipments` });
    expect(test.body.data.blocked).toBe(true);
    expect(test.body.data.reason).toMatch(/loopback|SSRF/);
    await request(app.app).put('/api/settings').set(op).send({ monitoring: { ssrfProtection: false }, actor: 'alice' });

    // Reads are open, mutations need the operator token, whoami reports the role.
    expect((await request(app.app).get('/api/monitors')).status).toBe(200);
    expect((await request(app.app).post('/api/monitors').send({ name: 'x', url: 'http://example.com' })).status).toBe(401);
    expect((await request(app.app).get('/api/auth/whoami')).body.data.role).toBe('reader');
    expect((await request(app.app).get('/api/auth/whoami').set(op)).body.data.role).toBe('operator');

    // Overview stats reflect real data.
    const stats = (await request(app.app).get('/api/stats/overview')).body.data as { cards: Array<{ id: string; value: string }>; traffic: unknown[]; responseTimes: unknown[] };
    expect(stats.cards.find((c) => c.id === 'registered_apis')?.value).toBe('1');
    expect(stats.traffic).toHaveLength(7);
    expect(stats.responseTimes).toHaveLength(6);
  });

  it('streams server-sent events for checks', async () => {
    const created = await request(app.app).post('/api/monitors').set(op).send({ name: 'SSE', url: `${baseUrl}/mock/shipping/shipments`, createdBy: 'alice' });
    const id = created.body.data.id as string;
    const received: string[] = [];
    const unsubscribe = app.guardianEvents.subscribe((ev) => received.push(ev.type));
    await request(app.app).post(`/api/monitors/${id}/check`).set(op).send({ actor: 'alice' });
    unsubscribe();
    expect(received).toContain('check.completed');
  });

  it('scheduler claims due monitors once and runs them', async () => {
    const created = await request(app.app).post('/api/monitors').set(op).send({ name: 'Sched', url: `${baseUrl}/mock/shipping/shipments`, intervalSec: 10, createdBy: 'alice' });
    const id = created.body.data.id as string;
    // Force due.
    await app.guardianStore.updateMonitor(id, { nextRunAt: new Date(Date.now() - 1000) });
    const started = await app.scheduler.tick();
    expect(started).toBe(1);
    const again = await app.scheduler.tick();
    expect(again).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    const checks = (await request(app.app).get(`/api/monitors/${id}/checks`)).body.data as unknown[];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });
});
