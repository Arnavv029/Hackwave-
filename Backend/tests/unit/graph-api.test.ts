import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { ErrorResponseBody } from '../../src/errors.js';
import { commerceDemoFixture } from '../../src/graph/fixtures.js';
import type { ImpactReportBody } from '../../src/graph/service.js';
import { buildTestApp, TEST_OPERATOR_TOKEN, type TestApp } from '../setup/app.js';

const op = { authorization: `Bearer ${TEST_OPERATOR_TOKEN}` };
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

const loadFixture = async () => {
  const res = await request(app).post('/api/graph/fixtures/commerce-demo').set(op);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { data: { nodes: number; edges: number } };
};
const node = (body: Record<string, unknown>, expectStatus = 201) =>
  request(app).post('/api/graph/nodes').set(op).send(body).then((r) => {
    expect(r.status, JSON.stringify(r.body)).toBe(expectStatus);
    return r.body as { data: { id: string; key: string }; error?: ErrorResponseBody['error'] };
  });
const edge = (body: Record<string, unknown>, expectStatus = 201) =>
  request(app).post('/api/graph/edges').set(op).send(body).then((r) => {
    expect(r.status, JSON.stringify(r.body)).toBe(expectStatus);
    return r.body as { data: { id: string }; error?: ErrorResponseBody['error'] & { details?: Record<string, unknown> } };
  });

describe('graph CRUD and validation', () => {
  it('creates, reads, updates and deletes nodes with parent resolution and cascade', async () => {
    await node({ kind: 'PROVIDER', key: 'users', name: 'Users' });
    const opNode = await node({ kind: 'OPERATION', key: 'users:GET:/users', name: 'GET /users', parentKey: 'users', method: 'GET', path: '/users' });
    await node({ kind: 'OPERATION', key: 'dup', name: 'x', parentKey: 'nope' }, 422);
    await node({ kind: 'PROVIDER', key: 'users', name: 'again' }, 409);
    await node({ kind: 'ROBOT', key: 'r', name: 'r' }, 400);
    await node({ kind: 'SERVICE', key: 'bad key!', name: 'r' }, 400);
    expect((await request(app).post('/api/graph/nodes').send({ kind: 'SERVICE', key: 's', name: 's' })).status).toBe(401);

    // Keys containing "/" must be URL-encoded to fit one path segment.
    const byKey = await request(app).get(`/api/graph/nodes/${encodeURIComponent('users:GET:/users')}`);
    expect(byKey.status).toBe(200);
    expect((byKey.body as { data: { id: string; incoming: unknown[] } }).data.id).toBe(opNode.data.id);
    const patched = await request(app).patch(`/api/graph/nodes/${opNode.data.id}`).set(op).send({ criticality: 'HIGH', metadata: { owner: 'team-a' } });
    expect(patched.status).toBe(200);
    expect((patched.body as { data: { criticality: string } }).data.criticality).toBe('HIGH');
    expect((await request(app).get('/api/graph/nodes?kind=OPERATION')).body).toMatchObject({ page: { total: 1 } });
    expect((await request(app).get('/api/graph/nodes?q=USERS')).body).toMatchObject({ page: { total: 2 } });

    expect((await request(app).delete('/api/graph/nodes/users').set(op)).status).toBe(204);
    expect((await request(app).get(`/api/graph/nodes/${encodeURIComponent('users:GET:/users')}`)).status).toBe(404);
  });

  it('validates edge endpoints, relation/kind pairs, direction, self-loops and duplicates', async () => {
    await node({ kind: 'PROVIDER', key: 'p', name: 'p' });
    await node({ kind: 'OPERATION', key: 'p:GET:/x', name: 'x', parentKey: 'p' });
    await node({ kind: 'ADAPTER', key: 'adapter:A', name: 'A' });
    await node({ kind: 'TEST', key: 'test:T', name: 'T' });

    expect((await edge({ from: 'p:GET:/x', to: 'adapter:missing', relation: 'CALLS' }, 422)).error?.message).toMatch(/does not exist/);
    const reversed = await edge({ from: 'adapter:A', to: 'p:GET:/x', relation: 'CALLS' }, 400);
    expect(reversed.error?.details?.['hint']).toMatch(/upstream -> downstream/);
    const wrongKinds = await edge({ from: 'p:GET:/x', to: 'test:T', relation: 'CALLS' }, 400);
    expect(wrongKinds.error?.details?.['hint']).toBeUndefined();
    expect(wrongKinds.error?.details?.['allowed']).toContain('OPERATION -> ADAPTER');
    expect((await edge({ from: 'adapter:A', to: 'adapter:A', relation: 'USES' }, 400)).error?.message).toMatch(/Self-loops/);
    await edge({ from: 'p:GET:/x', to: 'adapter:A', relation: 'NORMALIZES', consumedFields: ['id'], note: 'n' });
    await edge({ from: 'p:GET:/x', to: 'adapter:A', relation: 'NORMALIZES' }, 409);
    await edge({ from: 'p:GET:/x', to: 'adapter:A', relation: 'CALLS', provenance: 'INFERRED' });
    expect((await edge({ from: 'p:GET:/x', to: 'adapter:A', relation: 'CALLS', confidence: 2 }, 400)).error?.code).toBe('VALIDATION_ERROR');

    const list = await request(app).get('/api/graph/edges?from=p:GET:/x');
    expect((list.body as { page: { total: number } }).page.total).toBe(2);
    const inferred = (await request(app).get('/api/graph/edges?provenance=INFERRED')).body as { data: Array<{ id: string; confidence: number }> };
    expect(inferred.data).toHaveLength(1);
    expect(inferred.data[0]!.confidence).toBe(0.6);
    const upd = await request(app).patch(`/api/graph/edges/${inferred.data[0]!.id}`).set(op).send({ provenance: 'MANUAL', confidence: 1, consumedFields: ['id', 'name'] });
    expect((upd.body as { data: { provenance: string; consumedFields: string[] } }).data).toMatchObject({ provenance: 'MANUAL', consumedFields: ['id', 'name'] });
    expect((await request(app).delete(`/api/graph/edges/${inferred.data[0]!.id}`).set(op)).status).toBe(204);
    expect((await request(app).get(`/api/graph/edges/${inferred.data[0]!.id}`)).status).toBe(404);
  });

  it('loads the demo fixture idempotently and exposes conventions', async () => {
    const first = await loadFixture();
    expect(first.data).toEqual({ fixture: 'commerce-demo', nodes: commerceDemoFixture.nodes.length, edges: commerceDemoFixture.edges.length });
    await loadFixture();
    const g = (await request(app).get('/api/graph')).body as { data: { nodes: unknown[]; edges: unknown[] }; conventions: { direction: string; allowedEdges: Record<string, string[]> } };
    expect(g.data.nodes).toHaveLength(commerceDemoFixture.nodes.length);
    expect(g.data.edges).toHaveLength(commerceDemoFixture.edges.length);
    expect(g.conventions.direction).toMatch(/upstream -> downstream/);
    expect(g.conventions.allowedEdges['COVERED_BY']).toContain('WORKFLOW -> TEST');
    expect((await request(app).post('/api/graph/fixtures/nope').set(op)).status).toBe(404);
    expect((await request(app).get('/api/graph/fixtures')).body).toMatchObject({ data: [{ name: 'commerce-demo' }] });
  });
});

describe('impact analysis', () => {
  const chargeBody = { amount: 1_250, currency: 'USD', source_token: 'tok_visa' };
  const probe = async (body: Record<string, unknown> = { provider: 'payments', endpoint: 'createCharge', body: chargeBody }) => {
    const res = await request(app).post('/api/probes').send(body);
    expect(res.status).toBe(201);
    return res.body as { detection: { findings: Array<{ id: string; rule: string }> } };
  };
  async function findingFor(scenario: 'schema_rename' | 'http_503', provider: 'payments' | 'shipping' = 'payments'): Promise<Array<{ id: string; rule: string }>> {
    const body = provider === 'payments' ? undefined : { provider: 'shipping', endpoint: 'listShipments' };
    for (let i = 0; i < 3; i += 1) await probe(body);
    const create = await request(app).post('/api/baselines').set(op).send({ provider, endpoint: provider === 'payments' ? 'createCharge' : 'listShipments', config: { minSamplesForBaseline: 3, window: { size: 10, minSamples: 4 } }, createdBy: 'alice' });
    const id = (create.body as { data: { id: string } }).data.id;
    await request(app).post(`/api/baselines/${id}/submit`).set(op).send({ actor: 'alice' });
    await request(app).post(`/api/baselines/${id}/review`).set(op).send({ decision: 'approve', reviewer: 'bob' });
    await request(app).post(`/api/baselines/${id}/promote`).set(op).send({ actor: 'carol' });
    t.scenarioStore.activate(provider, scenario);
    return (await probe(body)).detection.findings;
  }

  it('connects a finding to the graph and ranks dependents by field consumption, depth and provenance', async () => {
    await loadFixture();
    const findings = await findingFor('schema_rename');
    const removed = findings.find((f) => f.rule === 'structural.field_removed')!;
    const res = await request(app).get(`/api/findings/${removed.id}/impact`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = (res.body as { data: ImpactReportBody }).data;

    expect(r.finding).toMatchObject({ id: removed.id, rule: 'structural.field_removed', changedPath: 'transaction_id', baselineVersion: 1 });
    expect(r.changedDependency).toMatchObject({ providerKey: 'payments', endpointKey: 'POST /charges', operation: { key: 'payments:POST:/charges' }, provider: { key: 'payments' } });
    const keys = r.dependents.map((d) => d.node.key);
    expect(keys[0]).toBe('adapter:PaymentsAdapter');
    expect(keys).toEqual(expect.arrayContaining(['service:CheckoutService', 'service:ReportingService', 'workflow:checkout', 'workflow:refund', 'workflow:finance-report']));
    expect(keys).not.toContain('adapter:ShippingAdapter');
    expect(keys).not.toContain('service:LegacyInventoryService');
    expect(keys).not.toContain('service:OrderTrackingService');

    const adapter = r.dependents[0]!;
    expect(adapter).toMatchObject({ depth: 1, direct: true, likelihood: 'HIGH' });
    expect(adapter.paths[0]!.steps[0]).toMatchObject({ relation: 'NORMALIZES', consumesChangedField: true });
    const checkout = r.dependents.find((d) => d.node.key === 'workflow:checkout')!;
    expect(checkout.paths[0]!.nodeKeys).toEqual(['payments:POST:/charges', 'adapter:PaymentsAdapter', 'service:CheckoutService', 'workflow:checkout']);
    expect(checkout.evidence.some((e) => e.includes('confirmed field use'))).toBe(true);
    const report = r.dependents.find((d) => d.node.key === 'workflow:finance-report')!;
    expect(report.score).toBeLessThan(checkout.score);

    expect(r.tests.map((x) => x.node.key).sort()).toEqual(['test:checkout-regression', 'test:finance-report-smoke', 'test:payments-adapter-contract', 'test:refund-regression']);
    expect(r.tests.find((x) => x.node.key === 'test:checkout-regression')!.covers).toEqual(['workflow:checkout']);
    expect(r.summary).toMatchObject({ direct: 1, tests: 4, maxLikelihood: 'HIGH' });
    expect(r.summary.byKind).toMatchObject({ ADAPTER: 1, SERVICE: 2, WORKFLOW: 3 });
    expect(r.traversal.truncated).toBe(false);
    expect(r.disclaimer).toMatch(/not proof/);
  });

  it('uses the inferred edge and the second operation to show lower-confidence impact', async () => {
    await loadFixture();
    const res = await request(app).get('/api/graph/impact?node=payments:GET:/charges/:id&path=status');
    expect(res.status).toBe(200);
    const r = (res.body as { data: ImpactReportBody }).data;
    expect(r.finding).toBeNull();
    const reporting = r.dependents.find((d) => d.node.key === 'service:ReportingService')!;
    expect(reporting.pathCount).toBe(2); // direct INFERRED CALLS + via PaymentsAdapter
    expect(reporting.paths.map((p) => p.steps.map((s) => s.relation).join('>')).sort()).toEqual(['CALLS', 'NORMALIZES>USES']);
    expect(r.summary.unconfirmedEdgesOnBestPaths).toBeGreaterThanOrEqual(0);
    const adapter = r.dependents.find((d) => d.node.key === 'adapter:PaymentsAdapter')!;
    expect(adapter.paths[0]!.steps[0]!.consumesChangedField).toBe(true);
  });

  it('semantic change on shipping reaches order tracking through the cycle without looping', async () => {
    await loadFixture();
    const findings = await findingFor('http_503', 'shipping');
    const status = findings.find((f) => f.rule === 'behavioral.status_changed')!;
    const r = ((await request(app).get(`/api/findings/${status.id}/impact?maxDepth=10`)).body as { data: ImpactReportBody }).data;
    expect(r.finding?.changedPath).toBeNull();
    const keys = r.dependents.map((d) => d.node.key);
    expect(keys).toEqual(expect.arrayContaining(['adapter:ShippingAdapter', 'service:OrderTrackingService', 'service:NotificationService', 'workflow:order-tracking', 'service:ReportingService']));
    expect(r.traversal.cyclesDetected).toBeGreaterThanOrEqual(1);
    expect(r.dependents.find((d) => d.node.key === 'adapter:ShippingAdapter')!.evidence[0]).toMatch(/affects every caller/);
  });

  it('reports no impact when the operation has no consumers, and 422 when the node is unknown to the graph', async () => {
    await loadFixture();
    const r = ((await request(app).get('/api/graph/impact?node=users:GET:/users')).body as { data: ImpactReportBody }).data;
    expect(r.dependents).toEqual([]);
    expect(r.summary.maxLikelihood).toBe('NONE');
    const findings = await findingFor('schema_rename');
    const graphless = buildTestApp({ store: t.store, findingStore: t.findingStore, baselineStore: t.baselineStore });
    const res = await request(graphless.app).get(`/api/findings/${findings[0]!.id}/impact`);
    expect(res.status).toBe(422);
    expect((await request(app).get('/api/findings/00000000-0000-7000-8000-000000000000/impact')).status).toBe(404);
    expect((await request(app).get('/api/graph/impact?node=users:GET:/users&maxDepth=99')).status).toBe(400);
  });

  it('honours traversal limits and persists snapshots for later phases', async () => {
    await loadFixture();
    const findings = await findingFor('schema_rename');
    const fid = findings[0]!.id;
    const shallow = ((await request(app).get(`/api/findings/${fid}/impact?maxDepth=1`)).body as { data: ImpactReportBody }).data;
    expect(shallow.dependents.map((d) => d.node.key)).toEqual(['adapter:PaymentsAdapter']);
    expect(shallow.traversal).toMatchObject({ truncated: true, truncationReasons: ['maxDepth'] });

    expect((await request(app).post(`/api/findings/${fid}/impact`).send({})).status).toBe(401);
    const saved = await request(app).post(`/api/findings/${fid}/impact`).set(op).send({ createdBy: 'erin', maxDepth: 4 });
    expect(saved.status).toBe(201);
    const { id, report } = (saved.body as { data: { id: string; report: ImpactReportBody } }).data;
    expect(report.traversal.limits.maxDepth).toBe(4);
    const fetched = await request(app).get(`/api/impact-reports/${id}`);
    expect(fetched.status).toBe(200);
    expect((fetched.body as { data: { findingId: string; dependentCount: number; maxLikelihood: string; createdBy: string } }).data).toMatchObject({ findingId: fid, dependentCount: report.summary.dependents, maxLikelihood: 'HIGH', createdBy: 'erin' });
    const list = await request(app).get(`/api/findings/${fid}/impact/reports`);
    expect((list.body as { data: Array<{ id: string }> }).data.map((x) => x.id)).toEqual([id]);
  });
});
