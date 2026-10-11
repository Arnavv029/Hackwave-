import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { InMemoryObservationStore } from '../../src/observation/store.js';
import type { ErrorResponseBody } from '../../src/errors.js';
import { buildTestApp, type TestApp } from '../setup/app.js';

interface Obs {
  id: string;
  providerKey: string;
  endpointKey: string;
  method: string;
  statusCode: number | null;
  outcome: string;
  errorCategory: string | null;
  parseOutcome: string;
  latencyMs: number;
  responseBytes: number;
  correlationId: string | null;
  scenario: string | null;
  observedAt: string;
  requestMeta: { path: string; queryKeys: string[]; headerNames: string[]; redactedHeaders: string[]; bodySample?: Record<string, unknown> };
  responseHeaders: { kept: Record<string, string>; redacted: string[]; omitted: string[] };
  fieldPaths: Array<{ path: string; type: string }> | null;
  shapeHash: string | null;
  shapeDelta: { added: string[]; removed: string[]; typeChanged: Array<{ path: string }>; comparedTo: string } | null;
  responseSample: unknown;
  contractCheck: { checked: boolean; valid: boolean | null; issues: Array<{ path: string; code: string }>; skippedReason?: string };
  errorMessage: string | null;
}

const SECRET = 'sk_live_superSecretKey123456';
const charge = { amount: 1_250, currency: 'USD', source_token: 'tok_visa_4242', idempotency_key: 'order-1' };

let t: TestApp;
let app: Express;
const probe = async (body: Record<string, unknown>, expectStatus = 201): Promise<Obs> => {
  const res = await request(app).post('/api/probes').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  return (res.body as { data: Obs }).data;
};
const createCharge = (extra: Record<string, unknown> = {}) => probe({ provider: 'payments', endpoint: 'createCharge', body: charge, ...extra });
const listShipments = (extra: Record<string, unknown> = {}) => probe({ provider: 'shipping', endpoint: 'listShipments', ...extra });

beforeEach(async () => {
  t = buildTestApp({ resolveSecret: (ref) => (ref === 'PAYMENTS_API_KEY' ? SECRET : undefined), timeoutMs: 400, maxResponseBytes: 64 * 1024 });
  app = t.app;
  await t.listen();
});
afterEach(async () => {
  await t.close();
});

describe('observation engine: baseline', () => {
  it('records a successful call with shape, headers, contract result and sanitized request metadata', async () => {
    const o = await createCharge({ correlationId: 'test-baseline-1' });
    expect(o).toMatchObject({
      providerKey: 'payments',
      endpointKey: 'POST /charges',
      method: 'POST',
      statusCode: 201,
      outcome: 'SUCCESS',
      errorCategory: null,
      parseOutcome: 'JSON',
      correlationId: 'test-baseline-1',
      scenario: 'baseline',
      errorMessage: null,
    });
    expect(o.latencyMs).toBeGreaterThanOrEqual(0);
    expect(o.responseBytes).toBeGreaterThan(0);
    expect(o.fieldPaths?.map((f) => f.path)).toEqual(['amount', 'created_at', 'currency', 'status', 'transaction_id']);
    expect(o.shapeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(o.contractCheck).toEqual({ checked: true, valid: true, issues: [], issueCount: 0 });
    expect(o.responseHeaders.kept['content-type']).toContain('application/json');
    expect(o.responseHeaders.redacted).toContain('set-cookie');
    expect(o.requestMeta.path).toBe('/mock/payments/charges');
    expect(o.requestMeta.headerNames).toContain('authorization');
    expect(o.requestMeta.redactedHeaders).toEqual(['authorization']);
    expect(o.requestMeta.bodySample).toMatchObject({ amount: 1_250, source_token: '[REDACTED]' });
  });

  it('never persists or logs the provider credential or session cookie', async () => {
    await createCharge();
    const persisted = JSON.stringify((t.store as InMemoryObservationStore).rows);
    expect(persisted).not.toContain(SECRET);
    expect(persisted).not.toContain('session-secret');
    expect(persisted).not.toContain('tok_visa_4242');
    const logs = t.lines.join('');
    expect(logs).not.toContain(SECRET);
    expect(logs).not.toContain('session-secret');
    expect(logs).toContain('observation recorded');
  });

  it('validates probe input against the endpoint contract before calling the provider', async () => {
    const bad = await request(app).post('/api/probes').send({ provider: 'payments', endpoint: 'createCharge', body: { amount: 'ten' } });
    expect(bad.status).toBe(400);
    expect((bad.body as ErrorResponseBody).error.code).toBe('VALIDATION_ERROR');
    expect((await request(app).post('/api/probes').send({ provider: 'payments', endpoint: 'nope' })).status).toBe(404);
    expect((await request(app).post('/api/probes').send({ provider: 'payments', endpoint: 'getCharge' })).status).toBe(400);
    expect((await request(app).post('/api/probes').send({ provider: 'users', endpoint: 'x' })).status).toBe(400);
    expect((t.store as InMemoryObservationStore).rows).toHaveLength(0);
  });
});

describe('observation engine: the five demo scenarios', () => {
  it('1. silent schema change: HTTP 200-class SUCCESS, contract invalid, shape delta shows the rename', async () => {
    const before = await createCharge();
    t.scenarioStore.activate('payments', 'schema_rename');
    const o = await createCharge({ correlationId: 'scenario-1' });
    expect(o.outcome).toBe('SUCCESS');
    expect(o.statusCode).toBe(201);
    expect(o.scenario).toBe('schema_rename');
    expect(o.contractCheck.valid).toBe(false);
    // Strict contract: the missing key is reported on its path, the unexpected key at the root.
    expect(o.contractCheck.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'transaction_id', code: 'invalid_type' }),
        expect.objectContaining({ path: '(root)', code: 'unrecognized_keys', message: expect.stringContaining('payment_reference') as unknown }),
      ]),
    );
    expect(o.shapeDelta).toMatchObject({ comparedTo: before.id, added: ['payment_reference'], removed: ['transaction_id'], typeChanged: [] });
    expect(o.shapeHash).not.toBe(before.shapeHash);
    expect(o.responseSample).toHaveProperty('payment_reference');
  });

  it('2. semantic change: identical shape, SUCCESS, contract flags the vocabulary, value preserved', async () => {
    const before = await listShipments();
    t.scenarioStore.activate('shipping', 'semantic_change');
    const o = await listShipments({ correlationId: 'scenario-2' });
    expect(o.outcome).toBe('SUCCESS');
    expect(o.shapeHash).toBe(before.shapeHash);
    expect(o.shapeDelta).toMatchObject({ added: [], removed: [], typeChanged: [] });
    expect(o.contractCheck.valid).toBe(false);
    expect(o.contractCheck.issues.some((i) => i.path.startsWith('data.') && i.path.endsWith('delivery_status'))).toBe(true);
    const sample = o.responseSample as { data: Array<{ delivery_status: string }> };
    expect(sample.data[0]?.delivery_status).toBe('in_transit');
  });

  it('3a. API unavailable (timeout): null status, TIMEOUT, nothing read', async () => {
    t.scenarioStore.activate('payments', 'timeout');
    const o = await createCharge({ correlationId: 'scenario-3a' });
    expect(o).toMatchObject({ statusCode: null, outcome: 'TIMEOUT', errorCategory: 'TIMEOUT', parseOutcome: 'NOT_READ', fieldPaths: null, shapeDelta: null });
    expect(o.latencyMs).toBeGreaterThanOrEqual(350);
    expect(o.contractCheck).toMatchObject({ checked: false, valid: null, skippedReason: 'no HTTP response' });
    expect(o.errorMessage).toMatch(/timed out/);
  });

  it('3b. API unavailable (connection failure): null status, CONNECTION_ERROR', async () => {
    t.scenarioStore.activate('shipping', 'connection_reset');
    const o = await listShipments({ correlationId: 'scenario-3b' });
    expect(o).toMatchObject({ statusCode: null, outcome: 'NETWORK_ERROR', errorCategory: 'CONNECTION_ERROR', parseOutcome: 'NOT_READ' });
    expect(o.responseHeaders).toEqual({ kept: {}, redacted: [], omitted: [] });
  });

  it('3c. API unavailable (HTTP 500 / 503): HTTP_ERROR vs UNAVAILABLE, error bodies still sampled', async () => {
    t.scenarioStore.activate('payments', 'http_500');
    const e500 = await createCharge();
    expect(e500).toMatchObject({ statusCode: 500, outcome: 'HTTP_ERROR', errorCategory: 'HTTP_ERROR', parseOutcome: 'JSON', errorMessage: 'HTTP 500' });
    expect(e500.fieldPaths?.map((f) => f.path)).toContain('error.code');
    t.scenarioStore.activate('payments', 'http_503');
    const e503 = await createCharge();
    expect(e503).toMatchObject({ statusCode: 503, outcome: 'UNAVAILABLE', errorCategory: 'UNAVAILABLE' });
    expect(e503.responseHeaders.kept['retry-after']).toBe('5');
    expect(e503.contractCheck.skippedReason).toMatch(/503/);
  });

  it('4. rate limiting: 429 with and without Retry-After', async () => {
    t.scenarioStore.activate('payments', 'rate_limited', { retryAfterSeconds: 30 });
    const withHeader = await createCharge({ correlationId: 'scenario-4' });
    expect(withHeader).toMatchObject({ statusCode: 429, outcome: 'RATE_LIMITED', errorCategory: 'RATE_LIMITED', errorMessage: 'HTTP 429 (retry-after: 30)' });
    expect(withHeader.responseHeaders.kept).toMatchObject({ 'retry-after': '30', 'x-ratelimit-remaining': '0' });
    t.scenarioStore.activate('payments', 'rate_limited');
    const without = await createCharge();
    expect(without.responseHeaders.kept['retry-after']).toBeUndefined();
    expect(without.errorMessage).toBe('HTTP 429');
  });

  it('5. unsafe data: SUCCESS, negative amount preserved verbatim, contract flags it', async () => {
    t.scenarioStore.activate('payments', 'unsafe_data');
    const o = await createCharge({ correlationId: 'scenario-5' });
    expect(o.outcome).toBe('SUCCESS');
    expect(o.errorCategory).toBeNull();
    expect((o.responseSample as { amount: number }).amount).toBe(-1_250);
    expect(o.contractCheck.valid).toBe(false);
    expect(o.contractCheck.issues).toEqual([expect.objectContaining({ path: 'amount' })]);
  });
});

describe('observation engine: additional fault cases', () => {
  it('malformed JSON: MALFORMED_RESPONSE with a redacted preview and no shape', async () => {
    t.scenarioStore.activate('payments', 'malformed_json');
    const o = await createCharge();
    expect(o).toMatchObject({ statusCode: 201, outcome: 'MALFORMED_RESPONSE', errorCategory: 'MALFORMED_JSON', parseOutcome: 'MALFORMED_JSON', fieldPaths: null });
    expect(o.responseSample).toMatchObject({ raw: expect.stringContaining('"amount":1250') as unknown });
    expect(o.errorMessage).toMatch(/malformed JSON/);
  });

  it('oversized response: reading stops at the byte cap', async () => {
    t.scenarioStore.activate('shipping', 'oversized_response', { sizeBytes: 200 * 1024 });
    const o = await listShipments();
    expect(o).toMatchObject({ statusCode: 200, outcome: 'MALFORMED_RESPONSE', errorCategory: 'RESPONSE_TOO_LARGE', parseOutcome: 'TRUNCATED', fieldPaths: null });
    // The mock declares content-length, so the client refuses before reading any body bytes.
    expect(o.responseBytes).toBe(0);
    expect(o.errorMessage).toMatch(/exceeds limit 65536/);
    expect(o.responseSample).toBeNull();
    expect(JSON.stringify(o).length).toBeLessThan(10_000);
  });

  it('slow response within the timeout is a SUCCESS with measured latency', async () => {
    t.scenarioStore.activate('shipping', 'slow_response', { delayMs: 150 });
    const o = await listShipments();
    expect(o.outcome).toBe('SUCCESS');
    expect(o.latencyMs).toBeGreaterThanOrEqual(140);
  });

  it('missing, added and mistyped fields show up as shape deltas and contract issues', async () => {
    await listShipments();
    t.scenarioStore.activate('shipping', 'missing_field', { field: 'carrier' });
    const missing = await listShipments();
    expect(missing.shapeDelta?.removed).toEqual(['data[].carrier']);
    expect(missing.contractCheck.valid).toBe(false);
    t.scenarioStore.reset('shipping');
    await listShipments();
    t.scenarioStore.activate('shipping', 'added_field', { field: 'eta_confidence' });
    const added = await listShipments();
    expect(added.shapeDelta?.added).toEqual(['data[].eta_confidence']);
    expect(added.shapeDelta?.removed).toEqual([]);
    t.scenarioStore.reset('shipping');
    await listShipments();
    t.scenarioStore.activate('shipping', 'wrong_type', { field: 'carrier' });
    const typed = await listShipments();
    expect(typed.shapeDelta?.typeChanged).toEqual([{ path: 'data[].carrier', from: 'string', to: 'number' }]);
  });

  it('connection refused on an unreachable provider is a CONNECTION_ERROR with null status', async () => {
    await t.close();
    t = buildTestApp({ providerBaseUrl: 'http://127.0.0.1:9/mock', timeoutMs: 1_000 });
    app = t.app;
    const o = await listShipments();
    expect(o).toMatchObject({ statusCode: null, outcome: 'NETWORK_ERROR', errorCategory: 'CONNECTION_ERROR' });
  });

  it('historical observations are preserved: every probe appends a row', async () => {
    await createCharge();
    t.scenarioStore.activate('payments', 'schema_rename');
    await createCharge();
    t.scenarioStore.reset('payments');
    await createCharge();
    const rows = (t.store as InMemoryObservationStore).rows;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.scenario)).toEqual(['baseline', 'schema_rename', 'baseline']);
    // The third compares against the second, so the rename shows up as reversed.
    expect(rows[2]?.shapeDelta).toMatchObject({ added: ['transaction_id'], removed: ['payment_reference'] });
  });
});

describe('observation API', () => {
  async function seed(): Promise<void> {
    await createCharge({ correlationId: 'run-A' });
    await listShipments({ correlationId: 'run-A' });
    t.scenarioStore.activate('payments', 'rate_limited', { retryAfterSeconds: 1 });
    await createCharge({ correlationId: 'run-B' });
    t.scenarioStore.activate('shipping', 'timeout');
    await listShipments({ correlationId: 'run-B' });
    t.scenarioStore.reset();
  }

  it('lists newest first with pagination metadata', async () => {
    await seed();
    const res = await request(app).get('/api/observations?limit=3');
    expect(res.status).toBe(200);
    const body = res.body as { data: Obs[]; page: { limit: number; offset: number; total: number; hasMore: boolean }; sort: unknown };
    expect(body.page).toEqual({ limit: 3, offset: 0, total: 4, hasMore: true });
    expect(body.sort).toEqual({ field: 'observedAt', order: 'desc' });
    expect(body.data.map((o) => o.outcome)).toEqual(['TIMEOUT', 'RATE_LIMITED', 'SUCCESS']);
    const next = await request(app).get('/api/observations?limit=3&offset=3');
    expect((next.body as { data: Obs[]; page: { hasMore: boolean } }).data).toHaveLength(1);
    expect((next.body as { page: { hasMore: boolean } }).page.hasMore).toBe(false);
    const asc = await request(app).get('/api/observations?sort=asc&limit=1');
    expect((asc.body as { data: Obs[] }).data[0]?.outcome).toBe('SUCCESS');
  });

  it('filters by provider, endpoint, method, status, outcome, error category, correlation id and time range', async () => {
    await seed();
    const count = async (qs: string): Promise<number> => {
      const res = await request(app).get(`/api/observations?${qs}`);
      expect(res.status, qs).toBe(200);
      return (res.body as { page: { total: number } }).page.total;
    };
    expect(await count('provider=payments')).toBe(2);
    expect(await count('endpoint=GET%20/shipments')).toBe(2);
    expect(await count('method=POST')).toBe(2);
    expect(await count('status=429')).toBe(1);
    expect(await count('outcome=TIMEOUT')).toBe(1);
    expect(await count('errorCategory=RATE_LIMITED')).toBe(1);
    expect(await count('correlationId=run-B')).toBe(2);
    expect(await count('provider=shipping&errorCategory=TIMEOUT')).toBe(1);
    expect(await count(`from=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`)).toBe(4);
    expect(await count(`to=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`)).toBe(0);
  });

  it('rejects invalid query parameters', async () => {
    for (const qs of ['limit=0', 'limit=1000', 'status=99', 'outcome=BROKEN', 'provider=users', 'sort=sideways', 'from=yesterday', 'unknown=1', 'from=2026-02-01&to=2026-01-01']) {
      const res = await request(app).get(`/api/observations?${qs}`);
      expect(res.status, qs).toBe(400);
      expect((res.body as ErrorResponseBody).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('fetches one observation by id and 404s otherwise', async () => {
    const created = await createCharge();
    const ok = await request(app).get(`/api/observations/${created.id}`);
    expect(ok.status).toBe(200);
    expect((ok.body as { data: Obs }).data.id).toBe(created.id);
    expect((await request(app).get('/api/observations/00000000-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await request(app).get('/api/observations/not-a-uuid')).status).toBe(404);
  });

  it('exposes the declared provider contracts', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.status).toBe(200);
    const data = (res.body as { data: Array<{ key: string; endpoints: Array<{ name: string; endpointKey: string }> }> }).data;
    expect(data.map((p) => p.key)).toEqual(['payments', 'shipping']);
    expect(data[0]?.endpoints.map((e) => e.endpointKey)).toEqual(['POST /charges', 'GET /charges/:id']);
  });
});
