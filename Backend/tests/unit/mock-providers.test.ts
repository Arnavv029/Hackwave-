import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { chargeSchema, shipmentListSchema } from '../../src/providers/contracts.js';
import { SCENARIOS } from '../../src/mocks/scenarios.js';
import { buildTestApp, TEST_CONTROL_TOKEN } from '../setup/app.js';

const auth = { authorization: `Bearer ${TEST_CONTROL_TOKEN}` };
const chargeBody = { amount: 1_250, currency: 'USD', source_token: 'tok_visa' };

describe('mock providers (baseline)', () => {
  it('payments baseline satisfies the contract and is deterministic per idempotency key', async () => {
    const { app } = buildTestApp();
    const a = await request(app).post('/mock/payments/charges').send({ ...chargeBody, idempotency_key: 'k1' });
    const b = await request(app).post('/mock/payments/charges').send({ ...chargeBody, idempotency_key: 'k1' });
    expect(a.status).toBe(201);
    expect(chargeSchema.safeParse(a.body).success).toBe(true);
    expect((a.body as { transaction_id: string }).transaction_id).toBe((b.body as { transaction_id: string }).transaction_id);
    expect(a.headers['x-mock-scenario']).toBe('baseline');
  });

  it('payments rejects contract-violating requests with 400', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/mock/payments/charges').send({ amount: -1, currency: 'usd' });
    expect(res.status).toBe(400);
  });

  it('shipping baseline paginates and satisfies the contract', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/mock/shipping/shipments?page=2&size=2');
    expect(res.status).toBe(200);
    expect(shipmentListSchema.safeParse(res.body).success).toBe(true);
    expect((res.body as { data: unknown[] }).data).toHaveLength(2);
    expect((await request(app).get('/mock/shipping/shipments/shp_9999')).status).toBe(404);
  });
});

describe('scenario controls', () => {
  it('require a bearer token', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/api/simulations')).status).toBe(401);
    expect((await request(app).post('/api/simulations/payments/http_500').set('authorization', 'Bearer nope')).status).toBe(401);
    const ok = await request(app).get('/api/simulations').set(auth);
    expect(ok.status).toBe(200);
    expect((ok.body as { catalog: unknown[] }).catalog).toHaveLength(SCENARIOS.length);
  });

  it('are not mounted in production, even with a token', async () => {
    const built = buildTestApp({ nodeEnv: 'production' });
    expect(built.scenarioControlsEnabled).toBe(false);
    const res = await request(built.app).post('/api/simulations/payments/http_500').set(auth);
    expect(res.status).toBe(404);
    // Mock providers themselves are still only mounted when explicitly enabled.
    const off = buildTestApp({ nodeEnv: 'production', mockProvidersEnabled: false });
    expect((await request(off.app).post('/mock/payments/charges').send(chargeBody)).status).toBe(404);
  });

  it('are not mounted without a configured token', async () => {
    const built = buildTestApp({ controlToken: undefined });
    expect(built.scenarioControlsEnabled).toBe(false);
    expect((await request(built.app).get('/api/simulations').set(auth)).status).toBe(404);
  });

  it('validate scenario names, options and provider applicability', async () => {
    const { app } = buildTestApp();
    expect((await request(app).post('/api/simulations/payments/not_a_scenario').set(auth)).status).toBe(400);
    expect((await request(app).post('/api/simulations/users/http_500').set(auth)).status).toBe(400);
    expect((await request(app).post('/api/simulations/shipping/schema_rename').set(auth)).status).toBe(400);
    expect((await request(app).post('/api/simulations/payments/semantic_change').set(auth)).status).toBe(400);
    expect((await request(app).post('/api/simulations/payments/slow_response').set(auth).send({ options: { delayMs: -1 } })).status).toBe(400);
    expect((await request(app).post('/api/simulations/payments/slow_response').set(auth).send({ bogus: 1 })).status).toBe(400);
  });

  it('activate deterministically, isolate providers, and reset', async () => {
    const { app, scenarioStore } = buildTestApp();
    const act = await request(app).post('/api/simulations/payments/rate_limited').set(auth).send({ options: { retryAfterSeconds: 7 } });
    expect(act.status).toBe(200);
    expect(scenarioStore.get('payments').scenario).toBe('rate_limited');
    expect(scenarioStore.get('shipping').scenario).toBe('baseline');

    const limited = await request(app).post('/mock/payments/charges').send(chargeBody);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('7');
    expect((await request(app).get('/mock/shipping/shipments')).status).toBe(200);

    // Re-activation replaces, never stacks.
    await request(app).post('/api/simulations/payments/http_500').set(auth);
    expect((await request(app).post('/mock/payments/charges').send(chargeBody)).status).toBe(500);

    await request(app).delete('/api/simulations/payments').set(auth);
    expect((await request(app).post('/mock/payments/charges').send(chargeBody)).status).toBe(201);

    await request(app).post('/api/simulations/shipping/http_503').set(auth);
    await request(app).delete('/api/simulations').set(auth);
    expect(scenarioStore.snapshot().every((s) => s.scenario === 'baseline')).toBe(true);
  });

  it('can scope a scenario to one endpoint', async () => {
    const { app } = buildTestApp();
    await request(app).post('/api/simulations/payments/http_500').set(auth).send({ options: { endpoint: 'GET /charges/:id' } });
    expect((await request(app).get('/mock/payments/charges/txn_abc')).status).toBe(500);
    expect((await request(app).post('/mock/payments/charges').send(chargeBody)).status).toBe(201);
  });
});

describe('scenario behaviours (direct provider calls)', () => {
  it('schema_rename returns 200 with payment_reference instead of transaction_id', async () => {
    const { app, scenarioStore } = buildTestApp();
    scenarioStore.activate('payments', 'schema_rename');
    const res = await request(app).post('/mock/payments/charges').send(chargeBody);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('payment_reference');
    expect(res.body).not.toHaveProperty('transaction_id');
  });

  it('semantic_change keeps the shape but changes the vocabulary', async () => {
    const { app, scenarioStore } = buildTestApp();
    scenarioStore.activate('shipping', 'semantic_change');
    const res = await request(app).get('/mock/shipping/shipments/shp_1001');
    expect(res.status).toBe(200);
    expect((res.body as { delivery_status: string }).delivery_status).toBe('in_transit');
    expect(shipmentListSchema.safeParse((await request(app).get('/mock/shipping/shipments')).body).success).toBe(false);
  });

  it('unsafe_data returns a negative amount with HTTP 201', async () => {
    const { app, scenarioStore } = buildTestApp();
    scenarioStore.activate('payments', 'unsafe_data');
    const res = await request(app).post('/mock/payments/charges').send(chargeBody);
    expect(res.status).toBe(201);
    expect((res.body as { amount: number }).amount).toBe(-1_250);
  });

  it('missing_field, added_field, wrong_type and malformed_json corrupt the body as configured', async () => {
    const { app, scenarioStore } = buildTestApp();
    scenarioStore.activate('shipping', 'missing_field');
    const stripped = (await request(app).get('/mock/shipping/shipments')).body as { data: Array<Record<string, unknown>> };
    expect(stripped.data.length).toBeGreaterThan(0);
    expect(stripped.data.every((s) => !('delivery_status' in s) && 'carrier' in s)).toBe(true);
    scenarioStore.activate('shipping', 'added_field', { field: 'eta_confidence' });
    expect((await request(app).get('/mock/shipping/shipments/shp_1001')).body).toHaveProperty('eta_confidence');
    scenarioStore.activate('payments', 'wrong_type', { field: 'amount' });
    expect(typeof ((await request(app).get('/mock/payments/charges/txn_1')).body as { amount: unknown }).amount).toBe('string');
    scenarioStore.activate('payments', 'malformed_json');
    // Read the raw body: supertest's own JSON parser would (correctly) reject it.
    const bad = await request(app)
      .get('/mock/payments/charges/txn_1')
      .buffer(true)
      .parse((res, cb) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          text += c;
        });
        res.on('end', () => {
          cb(null, text);
        });
      });
    expect(bad.status).toBe(200);
    expect(bad.headers['content-type']).toContain('application/json');
    const rawBody = bad.body as string;
    expect(() => JSON.parse(rawBody) as unknown).toThrow();
  });
});
