import { randomUUID } from 'node:crypto';
import type { DependencyEdge, DependencyNode, ImpactReport, Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { CreateEdgeInput, CreateNodeInput, EdgeProvenanceValue, EdgeRelationValue, NodeKindValue, UpdateEdgeInput, UpdateNodeInput } from './schemas.js';
import type { GraphEdgeSnapshot, GraphNodeSnapshot, GraphSnapshot } from './traversal.js';

export interface GraphNodeRecord extends GraphNodeSnapshot {
  parentId: string | null;
  baseUrl: string | null;
  secretRef: string | null;
  method: string | null;
  path: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphEdgeRecord extends GraphEdgeSnapshot {
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeFilter {
  kind?: NodeKindValue;
  enabled?: boolean;
  q?: string;
  limit: number;
  offset: number;
}
export interface EdgeFilter {
  sourceId?: string;
  targetId?: string;
  relation?: EdgeRelationValue;
  provenance?: EdgeProvenanceValue;
  limit: number;
  offset: number;
}

export type ResolvedNodeInput = Omit<CreateNodeInput, 'parentKey'> & { parentId?: string };
export type ResolvedEdgeInput = Omit<CreateEdgeInput, 'from' | 'to'> & { sourceId: string; targetId: string; confidence: number };

export interface GraphStore {
  createNode(input: ResolvedNodeInput): Promise<GraphNodeRecord>;
  /** Idempotent by key: existing nodes keep their id; mutable fields are updated. */
  upsertNode(input: ResolvedNodeInput): Promise<GraphNodeRecord>;
  updateNode(id: string, patch: Omit<UpdateNodeInput, 'parentKey'> & { parentId?: string }): Promise<GraphNodeRecord>;
  deleteNode(id: string): Promise<void>;
  findNode(idOrKey: string): Promise<GraphNodeRecord | null>;
  listNodes(filter: NodeFilter): Promise<{ rows: GraphNodeRecord[]; total: number }>;
  createEdge(input: ResolvedEdgeInput): Promise<GraphEdgeRecord>;
  upsertEdge(input: ResolvedEdgeInput): Promise<GraphEdgeRecord>;
  updateEdge(id: string, patch: UpdateEdgeInput): Promise<GraphEdgeRecord>;
  deleteEdge(id: string): Promise<void>;
  findEdge(id: string): Promise<GraphEdgeRecord | null>;
  findEdgeByTriple(sourceId: string, targetId: string, relation: EdgeRelationValue): Promise<GraphEdgeRecord | null>;
  listEdges(filter: EdgeFilter): Promise<{ rows: GraphEdgeRecord[]; total: number }>;
  /** Whole graph; bounded by `maxNodes`/`maxEdges` to keep traversal memory predictable. */
  snapshot(maxNodes?: number, maxEdges?: number): Promise<GraphSnapshot & { truncated: boolean }>;
}

export interface ImpactReportRecord {
  id: string;
  findingId: string | null;
  nodeId: string;
  report: Record<string, unknown>;
  dependentCount: number;
  testCount: number;
  maxLikelihood: string;
  truncated: boolean;
  createdBy: string;
  createdAt: Date;
}

export interface ImpactReportStore {
  save(input: Omit<ImpactReportRecord, 'id' | 'createdAt'>): Promise<ImpactReportRecord>;
  findById(id: string): Promise<ImpactReportRecord | null>;
  listForFinding(findingId: string, limit: number): Promise<ImpactReportRecord[]>;
}

export class DuplicateEdgeError extends Error {
  constructor() {
    super('an edge with this source, target and relation already exists');
    this.name = 'DuplicateEdgeError';
  }
}
export class DuplicateNodeKeyError extends Error {
  constructor(public readonly key: string) {
    super(`a node with key "${key}" already exists`);
    this.name = 'DuplicateNodeKeyError';
  }
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
function nodeFromRow(r: DependencyNode): GraphNodeRecord {
  return {
    id: r.id,
    key: r.key,
    kind: r.kind,
    name: r.name,
    enabled: r.enabled,
    criticality: r.criticality,
    parentId: r.parentId,
    baseUrl: r.baseUrl,
    secretRef: r.secretRef,
    method: r.method,
    path: r.path,
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
function edgeFromRow(r: DependencyEdge): GraphEdgeRecord {
  return {
    id: r.id,
    sourceId: r.sourceId,
    targetId: r.targetId,
    relation: r.relation,
    provenance: r.provenance,
    confidence: r.confidence,
    consumedFields: Array.isArray(r.consumedFields) ? (r.consumedFields as string[]) : [],
    note: r.note,
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaGraphStore implements GraphStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createNode(input: ResolvedNodeInput): Promise<GraphNodeRecord> {
    const existing = await this.prisma.dependencyNode.findUnique({ where: { key: input.key }, select: { id: true } });
    if (existing) throw new DuplicateNodeKeyError(input.key);
    return nodeFromRow(await this.prisma.dependencyNode.create({ data: { ...input, metadata: toJson(input.metadata) } }));
  }
  async upsertNode(input: ResolvedNodeInput): Promise<GraphNodeRecord> {
    const { key, kind, ...rest } = input;
    const data = { ...rest, metadata: toJson(input.metadata) };
    return nodeFromRow(await this.prisma.dependencyNode.upsert({ where: { key }, create: { key, kind, ...data }, update: data }));
  }
  async updateNode(id: string, patch: Omit<UpdateNodeInput, 'parentKey'> & { parentId?: string }): Promise<GraphNodeRecord> {
    const { metadata, ...rest } = patch;
    return nodeFromRow(await this.prisma.dependencyNode.update({ where: { id }, data: { ...rest, ...(metadata ? { metadata: toJson(metadata) } : {}) } }));
  }
  async deleteNode(id: string): Promise<void> {
    await this.prisma.dependencyNode.delete({ where: { id } });
  }
  async findNode(idOrKey: string): Promise<GraphNodeRecord | null> {
    const row = UUID_RE.test(idOrKey)
      ? await this.prisma.dependencyNode.findUnique({ where: { id: idOrKey } })
      : await this.prisma.dependencyNode.findUnique({ where: { key: idOrKey } });
    return row ? nodeFromRow(row) : null;
  }
  async listNodes(f: NodeFilter): Promise<{ rows: GraphNodeRecord[]; total: number }> {
    const where: Prisma.DependencyNodeWhereInput = {
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.enabled !== undefined ? { enabled: f.enabled } : {}),
      ...(f.q ? { OR: [{ key: { contains: f.q, mode: 'insensitive' } }, { name: { contains: f.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.dependencyNode.findMany({ where, orderBy: [{ kind: 'asc' }, { key: 'asc' }], take: f.limit, skip: f.offset }),
      this.prisma.dependencyNode.count({ where }),
    ]);
    return { rows: rows.map(nodeFromRow), total };
  }
  async createEdge(input: ResolvedEdgeInput): Promise<GraphEdgeRecord> {
    const dup = await this.findEdgeByTriple(input.sourceId, input.targetId, input.relation);
    if (dup) throw new DuplicateEdgeError();
    return edgeFromRow(
      await this.prisma.dependencyEdge.create({
        data: { ...input, consumedFields: toJson(input.consumedFields), metadata: toJson(input.metadata), note: input.note ?? null },
      }),
    );
  }
  async upsertEdge(input: ResolvedEdgeInput): Promise<GraphEdgeRecord> {
    const { sourceId, targetId, relation, ...rest } = input;
    const data = { ...rest, consumedFields: toJson(input.consumedFields), metadata: toJson(input.metadata), note: input.note ?? null };
    return edgeFromRow(
      await this.prisma.dependencyEdge.upsert({
        where: { sourceId_targetId_relation: { sourceId, targetId, relation } },
        create: { sourceId, targetId, relation, ...data },
        update: data,
      }),
    );
  }
  async updateEdge(id: string, patch: UpdateEdgeInput): Promise<GraphEdgeRecord> {
    const { consumedFields, metadata, ...rest } = patch;
    return edgeFromRow(
      await this.prisma.dependencyEdge.update({
        where: { id },
        data: { ...rest, ...(consumedFields ? { consumedFields: toJson(consumedFields) } : {}), ...(metadata ? { metadata: toJson(metadata) } : {}) },
      }),
    );
  }
  async deleteEdge(id: string): Promise<void> {
    await this.prisma.dependencyEdge.delete({ where: { id } });
  }
  async findEdge(id: string): Promise<GraphEdgeRecord | null> {
    const row = await this.prisma.dependencyEdge.findUnique({ where: { id } });
    return row ? edgeFromRow(row) : null;
  }
  async findEdgeByTriple(sourceId: string, targetId: string, relation: EdgeRelationValue): Promise<GraphEdgeRecord | null> {
    const row = await this.prisma.dependencyEdge.findUnique({ where: { sourceId_targetId_relation: { sourceId, targetId, relation } } });
    return row ? edgeFromRow(row) : null;
  }
  async listEdges(f: EdgeFilter): Promise<{ rows: GraphEdgeRecord[]; total: number }> {
    const where: Prisma.DependencyEdgeWhereInput = {
      ...(f.sourceId ? { sourceId: f.sourceId } : {}),
      ...(f.targetId ? { targetId: f.targetId } : {}),
      ...(f.relation ? { relation: f.relation } : {}),
      ...(f.provenance ? { provenance: f.provenance } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.dependencyEdge.findMany({ where, orderBy: { createdAt: 'asc' }, take: f.limit, skip: f.offset }),
      this.prisma.dependencyEdge.count({ where }),
    ]);
    return { rows: rows.map(edgeFromRow), total };
  }
  async snapshot(maxNodes = 5_000, maxEdges = 20_000): Promise<GraphSnapshot & { truncated: boolean }> {
    const [nodes, edges, nodeCount, edgeCount] = await Promise.all([
      this.prisma.dependencyNode.findMany({ take: maxNodes, orderBy: { key: 'asc' } }),
      this.prisma.dependencyEdge.findMany({ take: maxEdges, orderBy: { createdAt: 'asc' } }),
      this.prisma.dependencyNode.count(),
      this.prisma.dependencyEdge.count(),
    ]);
    return { nodes: nodes.map(nodeFromRow), edges: edges.map(edgeFromRow), truncated: nodeCount > maxNodes || edgeCount > maxEdges };
  }
}

function reportFromRow(r: ImpactReport): ImpactReportRecord {
  return {
    id: r.id,
    findingId: r.findingId,
    nodeId: r.nodeId,
    report: r.report as Record<string, unknown>,
    dependentCount: r.dependentCount,
    testCount: r.testCount,
    maxLikelihood: r.maxLikelihood,
    truncated: r.truncated,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export class PrismaImpactReportStore implements ImpactReportStore {
  constructor(private readonly prisma: PrismaClient) {}
  async save(input: Omit<ImpactReportRecord, 'id' | 'createdAt'>): Promise<ImpactReportRecord> {
    return reportFromRow(await this.prisma.impactReport.create({ data: { ...input, report: toJson(input.report) } }));
  }
  async findById(id: string): Promise<ImpactReportRecord | null> {
    const row = await this.prisma.impactReport.findUnique({ where: { id } });
    return row ? reportFromRow(row) : null;
  }
  async listForFinding(findingId: string, limit: number): Promise<ImpactReportRecord[]> {
    return (await this.prisma.impactReport.findMany({ where: { findingId }, orderBy: { createdAt: 'desc' }, take: limit })).map(reportFromRow);
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests)
// ---------------------------------------------------------------------------

export class InMemoryGraphStore implements GraphStore {
  readonly nodes: GraphNodeRecord[] = [];
  readonly edges: GraphEdgeRecord[] = [];

  createNode(input: ResolvedNodeInput): Promise<GraphNodeRecord> {
    if (this.nodes.some((n) => n.key === input.key)) return Promise.reject(new DuplicateNodeKeyError(input.key));
    const now = new Date();
    const row: GraphNodeRecord = {
      id: randomUUID(),
      key: input.key,
      kind: input.kind,
      name: input.name,
      enabled: input.enabled,
      criticality: input.criticality,
      parentId: input.parentId ?? null,
      baseUrl: input.baseUrl ?? null,
      secretRef: input.secretRef ?? null,
      method: input.method ?? null,
      path: input.path ?? null,
      metadata: structuredClone(input.metadata),
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.push(row);
    return Promise.resolve(structuredClone(row));
  }
  async upsertNode(input: ResolvedNodeInput): Promise<GraphNodeRecord> {
    const existing = this.nodes.find((n) => n.key === input.key);
    if (!existing) return this.createNode(input);
    const { key: _k, kind: _kind, parentId, ...rest } = input;
    Object.assign(existing, rest, { parentId: parentId ?? existing.parentId, updatedAt: new Date() });
    return structuredClone(existing);
  }
  updateNode(id: string, patch: Omit<UpdateNodeInput, 'parentKey'> & { parentId?: string }): Promise<GraphNodeRecord> {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) return Promise.reject(new Error('node not found'));
    Object.assign(n, patch, { updatedAt: new Date() });
    return Promise.resolve(structuredClone(n));
  }
  deleteNode(id: string): Promise<void> {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx >= 0) this.nodes.splice(idx, 1);
    // Cascade: children, and edges touching the node.
    for (const child of this.nodes.filter((n) => n.parentId === id)) void this.deleteNode(child.id);
    for (let i = this.edges.length - 1; i >= 0; i -= 1) {
      const e = this.edges[i] as GraphEdgeRecord;
      if (e.sourceId === id || e.targetId === id) this.edges.splice(i, 1);
    }
    return Promise.resolve();
  }
  findNode(idOrKey: string): Promise<GraphNodeRecord | null> {
    const n = this.nodes.find((x) => x.id === idOrKey || x.key === idOrKey);
    return Promise.resolve(n ? structuredClone(n) : null);
  }
  listNodes(f: NodeFilter): Promise<{ rows: GraphNodeRecord[]; total: number }> {
    const q = f.q?.toLowerCase();
    const rows = this.nodes
      .filter((n) => (!f.kind || n.kind === f.kind) && (f.enabled === undefined || n.enabled === f.enabled) && (!q || n.key.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
    return Promise.resolve({ rows: rows.slice(f.offset, f.offset + f.limit).map((r) => structuredClone(r)), total: rows.length });
  }
  createEdge(input: ResolvedEdgeInput): Promise<GraphEdgeRecord> {
    if (this.edges.some((e) => e.sourceId === input.sourceId && e.targetId === input.targetId && e.relation === input.relation)) return Promise.reject(new DuplicateEdgeError());
    const now = new Date();
    const row: GraphEdgeRecord = {
      id: randomUUID(),
      sourceId: input.sourceId,
      targetId: input.targetId,
      relation: input.relation,
      provenance: input.provenance,
      confidence: input.confidence,
      consumedFields: [...input.consumedFields],
      note: input.note ?? null,
      metadata: structuredClone(input.metadata),
      createdAt: now,
      updatedAt: now,
    };
    this.edges.push(row);
    return Promise.resolve(structuredClone(row));
  }
  async upsertEdge(input: ResolvedEdgeInput): Promise<GraphEdgeRecord> {
    const existing = this.edges.find((e) => e.sourceId === input.sourceId && e.targetId === input.targetId && e.relation === input.relation);
    if (!existing) return this.createEdge(input);
    Object.assign(existing, { provenance: input.provenance, confidence: input.confidence, consumedFields: [...input.consumedFields], note: input.note ?? null, metadata: structuredClone(input.metadata), updatedAt: new Date() });
    return structuredClone(existing);
  }
  updateEdge(id: string, patch: UpdateEdgeInput): Promise<GraphEdgeRecord> {
    const e = this.edges.find((x) => x.id === id);
    if (!e) return Promise.reject(new Error('edge not found'));
    Object.assign(e, patch, { updatedAt: new Date() });
    return Promise.resolve(structuredClone(e));
  }
  deleteEdge(id: string): Promise<void> {
    const idx = this.edges.findIndex((e) => e.id === id);
    if (idx >= 0) this.edges.splice(idx, 1);
    return Promise.resolve();
  }
  findEdge(id: string): Promise<GraphEdgeRecord | null> {
    const e = this.edges.find((x) => x.id === id);
    return Promise.resolve(e ? structuredClone(e) : null);
  }
  findEdgeByTriple(sourceId: string, targetId: string, relation: EdgeRelationValue): Promise<GraphEdgeRecord | null> {
    const e = this.edges.find((x) => x.sourceId === sourceId && x.targetId === targetId && x.relation === relation);
    return Promise.resolve(e ? structuredClone(e) : null);
  }
  listEdges(f: EdgeFilter): Promise<{ rows: GraphEdgeRecord[]; total: number }> {
    const rows = this.edges.filter((e) => (!f.sourceId || e.sourceId === f.sourceId) && (!f.targetId || e.targetId === f.targetId) && (!f.relation || e.relation === f.relation) && (!f.provenance || e.provenance === f.provenance));
    return Promise.resolve({ rows: rows.slice(f.offset, f.offset + f.limit).map((r) => structuredClone(r)), total: rows.length });
  }
  snapshot(maxNodes = 5_000, maxEdges = 20_000): Promise<GraphSnapshot & { truncated: boolean }> {
    return Promise.resolve({ nodes: this.nodes.slice(0, maxNodes).map((n) => structuredClone(n)), edges: this.edges.slice(0, maxEdges).map((e) => structuredClone(e)), truncated: this.nodes.length > maxNodes || this.edges.length > maxEdges });
  }
}

export class InMemoryImpactReportStore implements ImpactReportStore {
  readonly rows: ImpactReportRecord[] = [];
  save(input: Omit<ImpactReportRecord, 'id' | 'createdAt'>): Promise<ImpactReportRecord> {
    const row: ImpactReportRecord = { ...structuredClone(input), id: randomUUID(), createdAt: new Date() };
    this.rows.push(row);
    return Promise.resolve(structuredClone(row));
  }
  findById(id: string): Promise<ImpactReportRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
  listForFinding(findingId: string, limit: number): Promise<ImpactReportRecord[]> {
    return Promise.resolve(this.rows.filter((r) => r.findingId === findingId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map((r) => structuredClone(r)));
  }
}
