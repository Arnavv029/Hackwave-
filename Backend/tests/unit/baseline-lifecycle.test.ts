import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { InMemoryBaselineStore, InMemoryFindingStore } from '../../src/detection/stores.js';
import type { ErrorResponseBody } from '../../src/errors.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

const op = { authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
const chargeBody = { amount: 1_250, currency: 'USD', source_token: 'tok_visa' };
const smallConfig = { minSamplesForBaseline: 3, window: { size: 10, minSamples: 4 }, enumMinSamples: 3 };

interface Baseline { id: string; version: number; status: string; providerKey: string; endpointKey: string; sampleCount: number; summary: Record<string, unknown>; config: Record<string, unknown>; reviewedBy: string | null; promotedBy: string | null }
interface Finding { id: string; rule: string; kind: string; status: string; severity: string; confidence: number; fingerprint: string; occurrenceCount: number; observationIds: string[]; evidence: Record<string, unknown>; baselineId: string; summary: string }
interface ProbeResponse { data: { id: string }; detection: { evaluated: boolean; reason?: string; baseline?: { id: string; version: number }; findings: Finding[]; suppressed: number } }

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

const probe = async (body: Record<string, unknown> = { provider: 'payments', endpoint: 'createCharge', body: chargeBody }): Promise<ProbeResponse> => {
  const res = await request(app).post('/api/probes').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as ProbeResponse;
};
const probeN = async (n: number, body?: Record<string, unknown>): Promise<ProbeResponse[]> => {
  const out: ProbeResponse[] = [];
  for (let i = 0; i < n; i += 1) out.push(await probe(body));
  return out;
};
const createDraft = async (extra: Record<string, unknown> = {}, expectStatus = 201): Promise<Baseline> => {
  const res = await request(app).post('/api/baselines').set(op).send({ provider: 'payments', endpoint: 'createCharge', config: smallConfig, createdBy: 'alice', ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  return (res.body as { data: Baseline }).data;
};
const transition = (id: string, action: string, body: Record<string, unknown>, expectStatus = 200) =>
  request(app).post(`/api/baselines/${id}/${action}`).set(op).send(body).then((res) => {
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(expectStatus);
    return (res.body as { data: Baseline }).data;
  });
async function promoteBaseline(extra: Record<string, unknown> = {}): Promise<Baseline> {
  const draft = await createDraft(extra);
  await transition(draft.id, 'submit', { actor: 'alice' });
  await transition(draft.id, 'review', { decision: 'approve', reviewer: 'bob' });
  return transition(draft.id, 'promote', { actor: 'carol' });
}

describe('baseline lifecycle', () => {
  it('never treats observations as a baseline until one is explicitly created and promoted', async () => {
    const first = await probe();
    expect(first.detection).toMatchObject({ evaluated: false, reason: expect.stringContaining('no ACTIVE baseline') as unknown });
    await probeN(4);
    const draft = await createDraft();
    expect(draft.status).toBe('DRAFT');
    // Still not compared against: DRAFT is not ACTIVE.
    expect((await probe()).detection.evaluated).toBe(false);
    await transition(draft.id, 'submit', { actor: 'alice' });
    await transition(draft.id, 'review', { decision: 'approve', reviewer: 'bob' });
    expect((await probe()).detection.evaluated).toBe(false);
    await transition(draft.id, 'promote', { actor: 'carol' });
    const evaluated = await probe();
    expect(evaluated.detection).toMatchObject({ evaluated: true, baseline: { id: draft.id, version: 1 }, findings: [] });
  });

  it('requires enough observations and an existing endpoint', async () => {
    await probeN(2);
    const res = await request(app).post('/api/baselines').set(op).send({ provider: 'payments', endpoint: 'createCharge', config: smallConfig });
    expect(res.status).toBe(422);
    expect((res.body as ErrorResponseBody).error.details).toMatchObject({ have: 2, need: 3 });
    expect((await request(app).post('/api/baselines').set(op).send({ provider: 'payments', endpoint: 'nope' })).status).toBe(404);
    expect((await request(app).post('/api/baselines').set(op).send({ provider: 'payments', endpoint: 'createCharge', config: { bogus: 1 } })).status).toBe(400);
  });

  it('enforces the state machine, forbids self-approval, and keeps the summary immutable', async () => {
    await probeN(3);
    const draft = await createDraft();
    await transition(draft.id, 'promote', { actor: 'alice' }, 409);
    await transition(draft.id, 'review', { decision: 'approve', reviewer: 'bob' }, 409);
    await transition(draft.id, 'submit', { actor: 'alice' });
    await transition(draft.id, 'submit', { actor: 'alice' }, 409);
    const self = await request(app).post(`/api/baselines/${draft.id}/review`).set(op).send({ decision: 'approve', reviewer: 'alice' });
    expect(self.status).toBe(400);
    const approved = await transition(draft.id, 'review', { decision: 'approve', reviewer: 'bob', note: 'looks right' });
    expect(approved).toMatchObject({ status: 'APPROVED', reviewedBy: 'bob' });
    const promoted = await transition(draft.id, 'promote', { actor: 'carol' });
    expect(promoted).toMatchObject({ status: 'ACTIVE', promotedBy: 'carol' });
    await transition(draft.id, 'promote', { actor: 'carol' }, 409);

    const full = (await request(app).get(`/api/baselines/${draft.id}`)).body as { data: Baseline };
    expect(full.data.summary).toEqual(draft.summary);
    expect(full.data.config).toEqual(draft.config);
    expect(full.data.sampleCount).toBe(3);
    const store = t.baselineStore as InMemoryBaselineStore;
    expect(store.audit.map((a) => a.action)).toEqual(['baseline.drafted', 'baseline.submitted', 'baseline.approved', 'baseline.promoted']);
  });

  it('rejects a baseline and refuses to revive it', async () => {
    await probeN(3);
    const draft = await createDraft();
    const rejected = await transition(draft.id, 'review', { decision: 'reject', reviewer: 'bob', note: 'window includes an outage' });
    expect(rejected.status).toBe('REJECTED');
    await transition(draft.id, 'submit', { actor: 'alice' }, 409);
    expect((await probe()).detection.evaluated).toBe(false);
  });

  it('promoting a new version supersedes the previous one and keeps it readable', async () => {
    await probeN(3);
    const v1 = await promoteBaseline();
    await probeN(3);
    const v2 = await promoteBaseline();
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const list = (await request(app).get('/api/baselines?provider=payments')).body as { data: Baseline[]; page: { total: number } };
    expect(list.page.total).toBe(2);
    expect(Object.fromEntries(list.data.map((b) => [b.version, b.status]))).toEqual({ 1: 'SUPERSEDED', 2: 'ACTIVE' });
    expect((await probe()).detection.baseline).toEqual({ id: v2.id, version: 2 });
    expect((await request(app).get('/api/baselines?status=ACTIVE')).body).toMatchObject({ page: { total: 1 } });
  });

  it('requires the operator token for mutations but not for reads', async () => {
    await probeN(3);
    expect((await request(app).post('/api/baselines').send({ provider: 'payments', endpoint: 'createCharge' })).status).toBe(401);
    const draft = await createDraft();
    expect((await request(app).post(`/api/baselines/${draft.id}/submit`).send({ actor: 'x' })).status).toBe(401);
    expect((await request(app).get(`/api/baselines/${draft.id}`)).status).toBe(200);
    expect((await request(app).get('/api/baselines/00000000-0000-7000-8000-000000000000')).status).toBe(404);
  });

  it('produces a before/after report between two versions', async () => {
    await probeN(3);
    const v1 = await promoteBaseline();
    t.scenarioStore.activate('payments', 'schema_rename');
    await probeN(3);
    // Window limited to the three most recent (renamed) observations.
    const v2 = await createDraft({ maxSamples: 3 });
    const res = await request(app).get(`/api/baselines/compare?from=${v1.id}&to=${v2.id}`);
    expect(res.status).toBe(200);
    const report = (res.body as { data: { fields: { added: Array<{ path: string }>; removed: Array<{ path: string }> } } }).data;
    expect(report.fields.removed.map((f) => f.path)).toEqual(['transaction_id']);
    expect(report.fields.added.map((f) => f.path)).toEqual(['payment_reference']);
  });
});

describe('detection through the probe endpoint', () => {
  it('silent schema change: removed + rename candidate + added, deduplicated across repeats', async () => {
    await probeN(3);
    await promoteBaseline();
    t.scenarioStore.activate('payments', 'schema_rename');
    const first = await probe();
    expect(first.detection.findings.map((f) => f.rule)).toEqual(['structural.field_removed', 'structural.rename_candidate', 'structural.field_added']);
    const removed = first.detection.findings[0]!;
    expect(removed).toMatchObject({ kind: 'STRUCTURAL', severity: 'HIGH', status: 'OPEN', occurrenceCount: 1, fingerprint: 'structural.field_removed|transaction_id' });
    expect(removed.evidence).toMatchObject({ baselineVersion: 1, path: 'transaction_id' });

    const second = await probe();
    const again = second.detection.findings.find((f) => f.rule === 'structural.field_removed')!;
    expect(again.id).toBe(removed.id);
    expect(again.occurrenceCount).toBe(2);
    expect(again.observationIds).toEqual([first.data.id, second.data.id]);
    expect(again.confidence).toBeGreaterThan(removed.confidence);
    expect((t.findingStore as InMemoryFindingStore).rows).toHaveLength(3);
  });

  it('semantic vocabulary change: enum rule fires only once the baseline has a value distribution', async () => {
    await probeN(3, { provider: 'shipping', endpoint: 'listShipments' });
    const draft = await createDraft({ provider: 'shipping', endpoint: 'listShipments' });
    await transition(draft.id, 'submit', { actor: 'alice' });
    await transition(draft.id, 'review', { decision: 'approve', reviewer: 'bob' });
    await transition(draft.id, 'promote', { actor: 'carol' });
    t.scenarioStore.activate('shipping', 'semantic_change');
    const r = await probe({ provider: 'shipping', endpoint: 'listShipments' });
    const enumFinding = r.detection.findings.find((f) => f.rule === 'behavioral.enum_value_changed');
    expect(enumFinding).toBeDefined();
    expect(enumFinding!.evidence).toMatchObject({ path: 'data[].delivery_status', after: ['in_transit'] });
    expect(enumFinding!.summary).not.toMatch(/breaking|incompatible/);
    expect(r.detection.findings.map((f) => f.rule)).not.toContain('structural.field_removed');
  });

  it('unsafe data is NOT a structural finding (same shape, same type)', async () => {
    await probeN(3);
    await promoteBaseline();
    t.scenarioStore.activate('payments', 'unsafe_data');
    const r = await probe();
    expect(r.detection.evaluated).toBe(true);
    expect(r.detection.findings.map((f) => f.rule)).not.toContain('structural.type_changed');
  });

  it('intermittent failures: a lone 503 yields a status finding; sustained failures add rate findings', async () => {
    await probeN(4);
    await promoteBaseline();
    t.scenarioStore.activate('payments', 'http_503');
    const lone = await probe();
    expect(lone.detection.findings.map((f) => f.rule)).toEqual(['behavioral.status_changed']);
    t.scenarioStore.reset('payments');
    await probeN(2);
    t.scenarioStore.activate('payments', 'http_503');
    let last: ProbeResponse | undefined;
    for (let i = 0; i < 4; i += 1) last = await probe();
    const rules = last!.detection.findings.map((f) => f.rule);
    expect(rules).toContain('operational.error_rate_increase');
    expect(rules).toContain('availability.unavailable_rate_increase');
    expect(last!.detection.findings.find((f) => f.rule === 'operational.error_rate_increase')!.kind).toBe('STATISTICAL');
    const status = last!.detection.findings.find((f) => f.rule === 'behavioral.status_changed')!;
    expect(status.occurrenceCount).toBe(5);
  });

  it('timeouts: null status finding and a timeout-rate finding after enough samples', async () => {
    await probeN(4);
    await promoteBaseline();
    t.scenarioStore.activate('payments', 'timeout', { delayMs: 2_000 });
    let last: ProbeResponse | undefined;
    for (let i = 0; i < 4; i += 1) last = await probe({ provider: 'payments', endpoint: 'createCharge', body: chargeBody, timeoutMs: 150 });
    const rules = last!.detection.findings.map((f) => f.rule);
    expect(rules).toContain('behavioral.status_changed');
    expect(rules).toContain('availability.timeout_rate_increase');
  });
});

describe('findings API and lifecycle', () => {
  async function seedFinding(): Promise<Finding> {
    await probeN(3);
    await promoteBaseline();
    t.scenarioStore.activate('payments', 'schema_rename');
    return (await probe()).detection.findings[0]!;
  }

  it('lists, filters and fetches findings', async () => {
    await seedFinding();
    const all = (await request(app).get('/api/findings')).body as { data: Finding[]; page: { total: number } };
    expect(all.page.total).toBe(3);
    const count = async (qs: string) => ((await request(app).get(`/api/findings?${qs}`)).body as { page: { total: number } }).page.total;
    expect(await count('severity=HIGH')).toBe(1);
    expect(await count('rule=structural.rename_candidate')).toBe(1);
    expect(await count('kind=STATISTICAL')).toBe(0);
    expect(await count('provider=shipping')).toBe(0);
    expect(await count('status=OPEN&category=STRUCTURAL')).toBe(3);
    expect(await count(`baselineId=${all.data[0]!.baselineId}`)).toBe(3);
    expect((await request(app).get('/api/findings?severity=HUGE')).status).toBe(400);
    expect((await request(app).get(`/api/findings/${all.data[0]!.id}`)).status).toBe(200);
    expect((await request(app).get('/api/findings/00000000-0000-7000-8000-000000000000')).status).toBe(404);
    expect(((await request(app).get('/api/findings/rules')).body as { data: unknown[] }).data).toHaveLength(12);
  });

  it('walks OPEN -> ACKNOWLEDGED -> RESOLVED, reopens on recurrence, and rejects bad transitions', async () => {
    const f = await seedFinding();
    const patch = (status: string, expectStatus = 200) =>
      request(app).patch(`/api/findings/${f.id}/status`).set(op).send({ status, actor: 'dana', note: `-> ${status}` }).then((r) => {
        expect(r.status, JSON.stringify(r.body)).toBe(expectStatus);
        return (r.body as { data: Finding }).data;
      });
    expect((await request(app).patch(`/api/findings/${f.id}/status`).send({ status: 'ACKNOWLEDGED', actor: 'x' })).status).toBe(401);
    expect((await patch('ACKNOWLEDGED')).status).toBe('ACKNOWLEDGED');
    expect((await patch('RESOLVED')).status).toBe('RESOLVED');
    await patch('ACKNOWLEDGED', 409);
    // The change is still present, so the next probe reopens it.
    const again = (await probe()).detection.findings.find((x) => x.id === f.id)!;
    expect(again.status).toBe('OPEN');
    expect(again.occurrenceCount).toBe(2);
  });

  it('FALSE_POSITIVE suppresses recurrences without losing the count', async () => {
    const f = await seedFinding();
    const res = await request(app).patch(`/api/findings/${f.id}/status`).set(op).send({ status: 'FALSE_POSITIVE', actor: 'dana', note: 'field is deprecated upstream, consumers migrated' });
    expect(res.status).toBe(200);
    const next = await probe();
    expect(next.detection.findings.map((x) => x.id)).not.toContain(f.id);
    expect(next.detection.suppressed).toBe(1);
    const stored = (await request(app).get(`/api/findings/${f.id}`)).body as { data: Finding };
    expect(stored.data).toMatchObject({ status: 'FALSE_POSITIVE', occurrenceCount: 2 });
    expect((t.findingStore as InMemoryFindingStore).audit.map((a) => a.action)).toEqual(['finding.false_positive']);
  });
});
