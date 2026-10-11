import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/db/client.js';
import { createRepositories, type Repositories } from '../../src/db/repositories/index.js';
import { isUniqueViolation } from '../../src/db/errors.js';
import { createTestPrisma, DB_TESTS_ENABLED, truncateAll } from '../setup/db.js';

/**
 * Runs against a real PostgreSQL when RUN_DB_TESTS=1 (see `npm run test:db`).
 * Skipped otherwise so the unit suite stays hermetic.
 */
describe.skipIf(!DB_TESTS_ENABLED)('repositories (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let repos: Repositories;

  beforeAll(() => {
    prisma = createTestPrisma();
    repos = createRepositories(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function seedGraph() {
    const provider = await repos.nodes.create({ kind: 'PROVIDER', key: 'users', name: 'Users', baseUrl: 'http://users.local', secretRef: 'USERS_API_KEY' });
    const op = await repos.nodes.create({ kind: 'OPERATION', key: 'users:GET:/users', name: 'GET /users', parentId: provider.id, method: 'GET', path: '/users' });
    const client = await repos.nodes.create({ kind: 'CLIENT', key: 'client:UserClient', name: 'UserClient' });
    const profile = await repos.nodes.create({ kind: 'WORKFLOW', key: 'workflow:customer-profile', name: 'Customer profile', criticality: 'HIGH' });
    const checkout = await repos.nodes.create({ kind: 'WORKFLOW', key: 'workflow:checkout', name: 'Checkout', criticality: 'CRITICAL' });
    await repos.edges.create({ sourceId: provider.id, targetId: op.id, relation: 'EXPOSES' });
    await repos.edges.create({ sourceId: op.id, targetId: client.id, relation: 'CALLS' });
    await repos.edges.create({ sourceId: client.id, targetId: profile.id, relation: 'CONSUMES', note: 'expects internal `name`' });
    await repos.edges.create({ sourceId: client.id, targetId: checkout.id, relation: 'CONSUMES' });
    return { provider, op, client, profile, checkout };
  }

  it('enforces unique node keys and edge triples', async () => {
    await repos.nodes.create({ kind: 'PROVIDER', key: 'users', name: 'Users' });
    await expect(repos.nodes.create({ kind: 'PROVIDER', key: 'users', name: 'Dup' })).rejects.toSatisfy((e) =>
      isUniqueViolation(e, 'key'),
    );
    const { op, client } = await seedGraph().catch(async () => {
      await truncateAll(prisma);
      return seedGraph();
    });
    await expect(repos.edges.create({ sourceId: op.id, targetId: client.id, relation: 'CALLS' })).rejects.toSatisfy((e) =>
      isUniqueViolation(e),
    );
  });

  it('computes the downstream impact set of an operation', async () => {
    const { op, client, profile, checkout, provider } = await seedGraph();
    const downstream = await repos.edges.downstreamIds(op.id);
    expect(new Set(downstream)).toEqual(new Set([client.id, profile.id, checkout.id]));
    expect(downstream).not.toContain(provider.id);
  });

  it('versions baselines and keeps a single ACTIVE one per node', async () => {
    const { op } = await seedGraph();
    const v1 = await repos.baselines.createNextVersion({ nodeId: op.id, summary: { fields: ['id', 'name'] }, builtFrom: 'seed' });
    const v2 = await repos.baselines.createNextVersion({ nodeId: op.id, summary: { fields: ['id', 'name', 'email'] } });
    expect([v1.version, v2.version]).toEqual([1, 2]);

    await prisma.$transaction((tx) => createRepositories(tx).baselines.activate(v1.id));
    await prisma.$transaction((tx) => createRepositories(tx).baselines.activate(v2.id));

    const active = await repos.baselines.findActive(op.id);
    expect(active?.id).toBe(v2.id);
    const all = await repos.baselines.listForNode(op.id);
    expect(all.find((b) => b.id === v1.id)?.status).toBe('SUPERSEDED');
    expect(all.filter((b) => b.status === 'ACTIVE')).toHaveLength(1);
  });

  it('deduplicates findings by baseline + fingerprint', async () => {
    const { op } = await seedGraph();
    const baseline = await repos.baselines.createNextVersion({ nodeId: op.id, summary: {}, status: 'ACTIVE' });
    const obs = await repos.observations.create({ nodeId: op.id, outcome: 'SUCCESS', statusCode: 200, latencyMs: 42, responseShape: { id: 'string', display_name: 'string' }, shapeHash: 'h1' });

    const input = {
      nodeId: op.id,
      baselineId: baseline.id,
      observationId: obs.id,
      category: 'STRUCTURAL' as const,
      severity: 'HIGH' as const,
      confidence: 0.9,
      fingerprint: 'structural:removed=name;added=display_name',
      summary: 'Field `name` removed, `display_name` added',
      evidence: { removed: ['name'], added: ['display_name'] },
    };
    const first = await repos.findings.record(input);
    const second = await repos.findings.record({ ...input, confidence: 0.95 });
    expect(second.id).toBe(first.id);
    expect(second.occurrenceCount).toBe(2);
    expect(second.confidence).toBe(0.95);
    expect(await repos.findings.list({ nodeId: op.id, status: 'OPEN' })).toHaveLength(1);

    const resolved = await repos.findings.setStatus(first.id, 'RESOLVED');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it('runs the proposal -> version -> test run -> activate flow with audit events', async () => {
    const { op, profile } = await seedGraph();
    const baseline = await repos.baselines.createNextVersion({ nodeId: op.id, summary: {}, status: 'ACTIVE' });
    const finding = await repos.findings.record({
      nodeId: op.id, baselineId: baseline.id, category: 'STRUCTURAL', severity: 'HIGH', confidence: 0.9,
      fingerprint: 'fp', summary: 's', evidence: {},
    });

    const proposal = await repos.proposals.create({ findingId: finding.id, kind: 'FIELD_MAPPING', rationale: 'display_name is a non-empty string', risk: 'LOW', requiresHumanReview: false });
    const version = await repos.repairVersions.createNextVersion({ proposalId: proposal.id, spec: { map: [{ from: 'display_name', to: 'name' }] } });
    expect(version.version).toBe(1);
    expect(version.checksum).toHaveLength(64);

    const run = await repos.testRuns.create({ repairVersionId: version.id, workflowId: profile.id, triggeredBy: 'validate' });
    await repos.testRuns.start(run.id);
    const finished = await repos.testRuns.finish(run.id, { status: 'PASSED', results: [{ check: 'profile.name', passed: true }] });
    expect(finished.durationMs).toBeGreaterThanOrEqual(0);
    expect(await repos.testRuns.allPassed(version.id)).toBe(true);

    await prisma.$transaction(async (tx) => {
      const r = createRepositories(tx);
      await r.repairVersions.activate(version.id);
      await r.proposals.setStatus(proposal.id, 'ACTIVE');
      await r.findings.setStatus(finding.id, 'REPAIR_PROPOSED');
      await r.audit.append({ action: 'repair.activated', entityType: 'REPAIR_VERSION', entityId: version.id, details: { proposalId: proposal.id }, correlationId: 'corr-1' });
    });

    expect((await repos.repairVersions.findActive(proposal.id))?.id).toBe(version.id);
    expect((await repos.proposals.findById(proposal.id))?.status).toBe('ACTIVE');
    const events = await repos.audit.list({ correlationId: 'corr-1' });
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('repair.activated');
  });

  it('cascades deletes from a provider down to findings', async () => {
    const { provider, op } = await seedGraph();
    const baseline = await repos.baselines.createNextVersion({ nodeId: op.id, summary: {} });
    await repos.findings.record({ nodeId: op.id, baselineId: baseline.id, category: 'SEMANTIC', severity: 'LOW', confidence: 0.5, fingerprint: 'x', summary: 'x', evidence: {} });
    await repos.nodes.delete(provider.id);
    expect(await repos.nodes.findById(op.id)).toBeNull();
    expect(await repos.findings.list()).toHaveLength(0);
    // Edges touching the provider or its operation are gone; client -> workflow edges survive.
    const remaining = await repos.edges.listAll();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((e) => e.sourceId !== op.id && e.targetId !== op.id)).toBe(true);
  });
});
