import type { Severity } from '../generated/prisma/client.js';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { FindingRecord, FindingStore } from '../detection/stores.js';
import { GRAPH_FIXTURES, type GraphFixture } from './fixtures.js';
import { ALLOWED_EDGES, isAllowedEdge, type CreateEdgeInput, type CreateNodeInput, type EdgeRelationValue, type TraversalLimits, type UpdateEdgeInput, type UpdateNodeInput } from './schemas.js';
import {
  DuplicateEdgeError,
  DuplicateNodeKeyError,
  type EdgeFilter,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphStore,
  type ImpactReportRecord,
  type ImpactReportStore,
  type NodeFilter,
} from './stores.js';
import { traverseImpact, type ChangeContext, type Dependent, type GraphNodeSnapshot, type TraversalStats } from './traversal.js';

export interface GraphServiceDeps {
  graph: GraphStore;
  reports: ImpactReportStore;
  findings: FindingStore;
  logger: Logger;
}

const DEFAULT_CONFIDENCE = { OBSERVED: 1, MANUAL: 1, INFERRED: 0.6 } as const;

/** The readable impact report. */
export interface ImpactReportBody {
  generatedAt: string;
  finding: {
    id: string;
    rule: string;
    kind: string;
    severity: Severity;
    status: string;
    summary: string;
    baselineId: string;
    baselineVersion: number | null;
    changedPath: string | null;
    occurrenceCount: number;
  } | null;
  change: ChangeContext;
  changedDependency: {
    operation: GraphNodeSnapshot;
    provider: GraphNodeSnapshot | null;
    providerKey: string | null;
    endpointKey: string | null;
  };
  summary: {
    dependents: number;
    direct: number;
    indirect: number;
    byKind: Record<string, number>;
    byLikelihood: Record<'HIGH' | 'MEDIUM' | 'LOW', number>;
    tests: number;
    maxLikelihood: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    unconfirmedEdgesOnBestPaths: number;
  };
  dependents: Dependent[];
  tests: Array<{ node: GraphNodeSnapshot; likelihood: Dependent['likelihood']; score: number; covers: string[]; depth: number }>;
  traversal: TraversalStats & { graphTruncated: boolean };
  disclaimer: string;
}

const DISCLAIMER =
  'Reachability in the dependency graph is evidence of POTENTIAL impact, not proof of breakage. Field-consumption evidence and edge provenance adjust the ranking; only regression tests or manual verification can confirm it. Nothing here triggers a repair.';

export class GraphService {
  constructor(private readonly deps: GraphServiceDeps) {}

  // --- nodes ---------------------------------------------------------------

  async createNode(input: CreateNodeInput, mode: 'create' | 'upsert' = 'create'): Promise<GraphNodeRecord> {
    const { parentKey, ...rest } = input;
    let parentId: string | undefined;
    if (parentKey) {
      const parent = await this.deps.graph.findNode(parentKey);
      if (!parent) throw new UnprocessableError(`Parent node "${parentKey}" does not exist`);
      parentId = parent.id;
    }
    try {
      return mode === 'create'
        ? await this.deps.graph.createNode({ ...rest, ...(parentId ? { parentId } : {}) })
        : await this.deps.graph.upsertNode({ ...rest, ...(parentId ? { parentId } : {}) });
    } catch (err) {
      if (err instanceof DuplicateNodeKeyError) throw new ConflictError(err.message, { key: err.key });
      throw err;
    }
  }

  listNodes(filter: NodeFilter): Promise<{ rows: GraphNodeRecord[]; total: number }> {
    return this.deps.graph.listNodes(filter);
  }

  listEdges(filter: EdgeFilter): Promise<{ rows: GraphEdgeRecord[]; total: number }> {
    return this.deps.graph.listEdges(filter);
  }

  snapshot(maxNodes?: number, maxEdges?: number): ReturnType<GraphStore['snapshot']> {
    return this.deps.graph.snapshot(maxNodes, maxEdges);
  }

  async getNode(idOrKey: string): Promise<GraphNodeRecord> {
    const n = await this.deps.graph.findNode(idOrKey);
    if (!n) throw new NotFoundError(`Node "${idOrKey}" not found`);
    return n;
  }

  async updateNode(idOrKey: string, patch: UpdateNodeInput): Promise<GraphNodeRecord> {
    const n = await this.getNode(idOrKey);
    const { parentKey, ...rest } = patch;
    let parentId: string | undefined;
    if (parentKey) {
      const parent = await this.getNode(parentKey);
      if (parent.id === n.id) throw new ValidationError('A node cannot be its own parent');
      parentId = parent.id;
    }
    return this.deps.graph.updateNode(n.id, { ...rest, ...(parentId ? { parentId } : {}) });
  }

  async deleteNode(idOrKey: string): Promise<void> {
    const n = await this.getNode(idOrKey);
    await this.deps.graph.deleteNode(n.id);
  }

  // --- edges ---------------------------------------------------------------

  async createEdge(input: CreateEdgeInput, mode: 'create' | 'upsert' = 'create'): Promise<GraphEdgeRecord & { source: GraphNodeRecord; target: GraphNodeRecord }> {
    const [source, target] = await Promise.all([this.deps.graph.findNode(input.from), this.deps.graph.findNode(input.to)]);
    if (!source) throw new UnprocessableError(`Upstream node "${input.from}" does not exist`, { field: 'from' });
    if (!target) throw new UnprocessableError(`Downstream node "${input.to}" does not exist`, { field: 'to' });
    this.assertEdgeAllowed(input.relation, source, target);
    const resolved = {
      ...input,
      sourceId: source.id,
      targetId: target.id,
      confidence: input.confidence ?? DEFAULT_CONFIDENCE[input.provenance],
    };
    const { from: _f, to: _t, ...data } = resolved;
    try {
      const edge = mode === 'create' ? await this.deps.graph.createEdge(data) : await this.deps.graph.upsertEdge(data);
      return { ...edge, source, target };
    } catch (err) {
      if (err instanceof DuplicateEdgeError) throw new ConflictError(err.message, { from: source.key, to: target.key, relation: input.relation });
      throw err;
    }
  }

  private assertEdgeAllowed(relation: EdgeRelationValue, source: GraphNodeRecord, target: GraphNodeRecord): void {
    if (source.id === target.id) throw new ValidationError('Self-loops are not allowed', { node: source.key });
    if (isAllowedEdge(relation, source.kind, target.kind)) return;
    const reversed = isAllowedEdge(relation, target.kind, source.kind);
    throw new ValidationError(
      `${relation} edges are not allowed from ${source.kind} to ${target.kind}`,
      {
        relation,
        from: { key: source.key, kind: source.kind },
        to: { key: target.key, kind: target.kind },
        allowed: ALLOWED_EDGES[relation].map(([a, b]) => `${a} -> ${b}`),
        ...(reversed ? { hint: 'Edges point upstream -> downstream (impact flow). Swap `from` and `to`.' } : {}),
      },
    );
  }

  async getEdge(id: string): Promise<GraphEdgeRecord> {
    const e = await this.deps.graph.findEdge(id);
    if (!e) throw new NotFoundError('Edge not found');
    return e;
  }

  async updateEdge(id: string, patch: UpdateEdgeInput): Promise<GraphEdgeRecord> {
    await this.getEdge(id);
    return this.deps.graph.updateEdge(id, patch);
  }

  async deleteEdge(id: string): Promise<void> {
    await this.getEdge(id);
    await this.deps.graph.deleteEdge(id);
  }

  // --- fixtures ------------------------------------------------------------

  listFixtures(): Array<Pick<GraphFixture, 'name' | 'description'> & { nodes: number; edges: number }> {
    return Object.values(GRAPH_FIXTURES).map((f) => ({ name: f.name, description: f.description, nodes: f.nodes.length, edges: f.edges.length }));
  }

  /** Idempotent: nodes are upserted by key, edges by (from, to, relation). */
  async loadFixture(name: string): Promise<{ fixture: string; nodes: number; edges: number }> {
    const fixture = GRAPH_FIXTURES[name];
    if (!fixture) throw new NotFoundError(`Unknown fixture "${name}"`, { available: Object.keys(GRAPH_FIXTURES) });
    for (const n of fixture.nodes) await this.createNode(n, 'upsert');
    for (const e of fixture.edges) await this.createEdge(e, 'upsert');
    this.deps.logger.info({ fixture: name, nodes: fixture.nodes.length, edges: fixture.edges.length }, 'graph fixture loaded');
    return { fixture: name, nodes: fixture.nodes.length, edges: fixture.edges.length };
  }

  // --- impact --------------------------------------------------------------

  async impactForFinding(findingId: string, limits: TraversalLimits): Promise<ImpactReportBody> {
    const finding = await this.deps.findings.findById(findingId);
    if (!finding) throw new NotFoundError('Finding not found');
    const origin = await this.deps.graph.findNode(finding.nodeId);
    if (!origin) throw new UnprocessableError('The finding references a node that is not in the graph', { nodeId: finding.nodeId });
    return this.buildReport(origin, changeFromFinding(finding), finding, limits);
  }

  async impactForNode(idOrKey: string, change: Partial<ChangeContext>, limits: TraversalLimits): Promise<ImpactReportBody> {
    const origin = await this.getNode(idOrKey);
    const ctx: ChangeContext = { severity: change.severity ?? 'MEDIUM', rule: change.rule ?? 'manual.what_if', ...(change.changedPath ? { changedPath: change.changedPath } : {}) };
    return this.buildReport(origin, ctx, null, limits);
  }

  async persistReport(report: ImpactReportBody, createdBy: string): Promise<ImpactReportRecord> {
    const saved = await this.deps.reports.save({
      findingId: report.finding?.id ?? null,
      nodeId: report.changedDependency.operation.id,
      report: report as unknown as Record<string, unknown>,
      dependentCount: report.summary.dependents,
      testCount: report.summary.tests,
      maxLikelihood: report.summary.maxLikelihood,
      truncated: report.traversal.truncated,
      createdBy,
    });
    this.deps.logger.info({ impactReportId: saved.id, findingId: saved.findingId, dependents: saved.dependentCount, maxLikelihood: saved.maxLikelihood }, 'impact report persisted');
    return saved;
  }

  async getReport(id: string): Promise<ImpactReportRecord> {
    const r = await this.deps.reports.findById(id);
    if (!r) throw new NotFoundError('Impact report not found');
    return r;
  }

  listReportsForFinding(findingId: string, limit = 20): Promise<ImpactReportRecord[]> {
    return this.deps.reports.listForFinding(findingId, limit);
  }

  private async buildReport(origin: GraphNodeRecord, change: ChangeContext, finding: FindingRecord | null, limits: TraversalLimits): Promise<ImpactReportBody> {
    const graph = await this.deps.graph.snapshot();
    const result = traverseImpact(graph, origin.id, change, limits);
    const provider = origin.parentId ? graph.nodes.find((n) => n.id === origin.parentId) ?? null : null;
    const nonTests = result.dependents.filter((d) => d.node.kind !== 'TEST');
    const tests = result.dependents
      .filter((d) => d.node.kind === 'TEST')
      .map((d) => ({
        node: d.node,
        likelihood: d.likelihood,
        score: d.score,
        depth: d.depth,
        covers: [...new Set(d.paths.map((p) => p.nodeKeys[p.nodeKeys.length - 2]).filter((k): k is string => k !== undefined))],
      }));
    const byKind: Record<string, number> = {};
    const byLikelihood = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const d of nonTests) {
      byKind[d.node.kind] = (byKind[d.node.kind] ?? 0) + 1;
      byLikelihood[d.likelihood] += 1;
    }
    const maxLikelihood = byLikelihood.HIGH ? 'HIGH' : byLikelihood.MEDIUM ? 'MEDIUM' : byLikelihood.LOW ? 'LOW' : 'NONE';
    return {
      generatedAt: new Date().toISOString(),
      finding: finding
        ? {
            id: finding.id,
            rule: finding.rule,
            kind: finding.kind,
            severity: finding.severity,
            status: finding.status,
            summary: finding.summary,
            baselineId: finding.baselineId,
            baselineVersion: typeof finding.evidence['baselineVersion'] === 'number' ? finding.evidence['baselineVersion'] : null,
            changedPath: change.changedPath ?? null,
            occurrenceCount: finding.occurrenceCount,
          }
        : null,
      change,
      changedDependency: {
        operation: toSnapshot(origin),
        provider: provider ? toSnapshot(provider) : null,
        providerKey: finding?.providerKey ?? provider?.key ?? null,
        endpointKey: finding?.endpointKey ?? (origin.method && origin.path ? `${origin.method} ${origin.path}` : null),
      },
      summary: {
        dependents: nonTests.length,
        direct: nonTests.filter((d) => d.direct).length,
        indirect: nonTests.filter((d) => !d.direct).length,
        byKind,
        byLikelihood,
        tests: tests.length,
        maxLikelihood,
        unconfirmedEdgesOnBestPaths: nonTests.filter((d) => d.weakestProvenance === 'INFERRED').length,
      },
      dependents: nonTests,
      tests,
      traversal: { ...result.stats, graphTruncated: graph.truncated },
      disclaimer: DISCLAIMER,
    };
  }
}

/** Translate a finding into what the traversal needs to know about the change. */
export function changeFromFinding(f: FindingRecord): ChangeContext {
  const ev = f.evidence;
  const path = typeof ev['path'] === 'string' ? ev['path'] : typeof ev['from'] === 'string' ? ev['from'] : undefined;
  return { severity: f.severity, rule: f.rule, ...(path ? { changedPath: path } : {}) };
}

function toSnapshot(n: GraphNodeSnapshot): GraphNodeSnapshot {
  return { id: n.id, key: n.key, kind: n.kind, name: n.name, enabled: n.enabled, criticality: n.criticality };
}
