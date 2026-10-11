import { randomUUID } from 'node:crypto';
import type { Baseline, BaselineStatus, DetectionKind, Finding, FindingCategory, FindingStatus, Prisma, Severity } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { DbClient } from '../db/types.js';
import { operationNodeKey, type ProviderKey } from '../providers/contracts.js';
import type { DetectionConfig } from './config.js';
import { baselineSummarySchema, type BaselineSummary } from './summary.js';

/**
 * Persistence seams for baselines and findings. Prisma for the server,
 * in-memory for hermetic tests. Baseline summaries are never updated by
 * either implementation: only status/review columns change.
 */

export interface BaselineRecord {
  id: string;
  nodeId: string;
  version: number;
  status: BaselineStatus;
  providerKey: ProviderKey;
  endpointKey: string;
  contextKey: string;
  summary: BaselineSummary;
  config: DetectionConfig;
  sampleCount: number;
  builtFrom: string;
  windowFrom: Date;
  windowTo: Date;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  promotedBy: string | null;
  activatedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBaseline {
  providerKey: ProviderKey;
  endpointKey: string;
  contextKey: string;
  summary: BaselineSummary;
  config: DetectionConfig;
  windowFrom: Date;
  windowTo: Date;
  createdBy: string;
  builtFrom: string;
}

export interface BaselineTransition {
  status: BaselineStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string | null;
  promotedBy?: string;
  activatedAt?: Date;
  supersededAt?: Date;
}

export interface AuditEntry {
  action: string;
  actor: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export interface BaselineListFilter {
  provider?: ProviderKey;
  endpoint?: string;
  status?: BaselineStatus;
  limit: number;
  offset: number;
}

export interface BaselineStore {
  create(input: NewBaseline, audit: AuditEntry): Promise<BaselineRecord>;
  findById(id: string): Promise<BaselineRecord | null>;
  findActive(providerKey: ProviderKey, endpointKey: string, contextKey: string): Promise<BaselineRecord | null>;
  list(filter: BaselineListFilter): Promise<{ rows: BaselineRecord[]; total: number }>;
  transition(id: string, patch: BaselineTransition, audit: AuditEntry): Promise<BaselineRecord>;
  /** Atomically mark `id` ACTIVE and supersede other ACTIVE baselines for the same context. */
  promote(id: string, actor: string, now: Date): Promise<BaselineRecord>;
}

export interface FindingRecord {
  id: string;
  nodeId: string;
  baselineId: string;
  observationId: string | null;
  providerKey: ProviderKey;
  endpointKey: string;
  rule: string;
  kind: DetectionKind;
  category: FindingCategory;
  severity: Severity;
  status: FindingStatus;
  confidence: number;
  fingerprint: string;
  summary: string;
  evidence: Record<string, unknown>;
  observationIds: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
  resolvedAt: Date | null;
  statusNote: string | null;
  statusChangedBy: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFinding {
  nodeId: string;
  baselineId: string;
  observationId: string;
  providerKey: ProviderKey;
  endpointKey: string;
  rule: string;
  kind: DetectionKind;
  category: FindingCategory;
  severity: Severity;
  confidence: number;
  fingerprint: string;
  summary: string;
  evidence: Record<string, unknown>;
  seenAt: Date;
}

export interface FindingRecurrence {
  severity: Severity;
  confidence: number;
  summary: string;
  evidence: Record<string, unknown>;
  observationId: string;
  seenAt: Date;
  /** When true the finding returns to OPEN (used for RESOLVED findings that recur). */
  reopen: boolean;
}

export interface FindingStatusChange {
  status: FindingStatus;
  actor: string;
  note?: string;
  now: Date;
}

export interface FindingListFilter {
  provider?: ProviderKey;
  endpoint?: string;
  status?: FindingStatus;
  severity?: Severity;
  category?: FindingCategory;
  kind?: DetectionKind;
  rule?: string;
  baselineId?: string;
  limit: number;
  offset: number;
}

export const MAX_OBSERVATION_REFS = 20;

export interface FindingStore {
  findByFingerprint(baselineId: string, fingerprint: string): Promise<FindingRecord | null>;
  create(input: NewFinding): Promise<FindingRecord>;
  recordRecurrence(id: string, update: FindingRecurrence): Promise<FindingRecord>;
  findById(id: string): Promise<FindingRecord | null>;
  list(filter: FindingListFilter): Promise<{ rows: FindingRecord[]; total: number }>;
  setStatus(id: string, change: FindingStatusChange, audit: AuditEntry): Promise<FindingRecord>;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function baselineFromRow(row: Baseline): BaselineRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    version: row.version,
    status: row.status,
    providerKey: (row.providerKey ?? 'payments') as ProviderKey,
    endpointKey: row.endpointKey ?? '',
    contextKey: row.contextKey,
    summary: row.summary as BaselineSummary,
    config: row.config as DetectionConfig,
    sampleCount: row.sampleCount,
    builtFrom: row.builtFrom,
    windowFrom: row.windowFrom ?? row.createdAt,
    windowTo: row.windowTo ?? row.createdAt,
    createdBy: row.createdBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    promotedBy: row.promotedBy,
    activatedAt: row.activatedAt,
    supersededAt: row.supersededAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findingFromRow(row: Finding): FindingRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    baselineId: row.baselineId,
    observationId: row.observationId,
    providerKey: (row.providerKey ?? 'payments') as ProviderKey,
    endpointKey: row.endpointKey ?? '',
    rule: row.rule,
    kind: row.kind,
    category: row.category,
    severity: row.severity,
    status: row.status,
    confidence: row.confidence,
    fingerprint: row.fingerprint,
    summary: row.summary,
    evidence: (row.evidence as Record<string, unknown> | null) ?? {},
    observationIds: Array.isArray(row.observationIds) ? (row.observationIds as string[]) : [],
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    occurrenceCount: row.occurrenceCount,
    resolvedAt: row.resolvedAt,
    statusNote: row.statusNote,
    statusChangedBy: row.statusChangedBy,
    statusChangedAt: row.statusChangedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function appendAudit(db: DbClient, entityType: 'BASELINE' | 'FINDING', entityId: string, audit: AuditEntry): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorType: audit.actor === 'system' ? 'SYSTEM' : 'USER',
      actorId: audit.actor,
      action: audit.action,
      entityType,
      entityId,
      details: toJson(audit.details ?? {}),
      correlationId: audit.correlationId ?? null,
    },
  });
}

export class PrismaBaselineStore implements BaselineStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewBaseline, audit: AuditEntry): Promise<BaselineRecord> {
    const summary = baselineSummarySchema.parse(input.summary);
    return this.prisma.$transaction(async (tx) => {
      const node = await this.resolveNode(tx, input.providerKey, input.endpointKey);
      const latest = await tx.baseline.findFirst({ where: { nodeId: node.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const row = await tx.baseline.create({
        data: {
          nodeId: node.id,
          version: (latest?.version ?? 0) + 1,
          status: 'DRAFT',
          providerKey: input.providerKey,
          endpointKey: input.endpointKey,
          contextKey: input.contextKey,
          summary: toJson(summary),
          config: toJson(input.config),
          sampleCount: summary.sampleCount,
          builtFrom: input.builtFrom,
          windowFrom: input.windowFrom,
          windowTo: input.windowTo,
          createdBy: input.createdBy,
        },
      });
      await appendAudit(tx, 'BASELINE', row.id, audit);
      return baselineFromRow(row);
    });
  }

  private async resolveNode(db: DbClient, providerKey: ProviderKey, endpointKey: string): Promise<{ id: string }> {
    const [method, path] = endpointKey.split(' ', 2);
    const key = operationNodeKey(providerKey, { method: method as never, path: path ?? '' });
    const node = await db.dependencyNode.findUnique({ where: { key }, select: { id: true } });
    if (!node) throw new Error(`no OPERATION node for ${key}; record at least one observation first`);
    return node;
  }

  async findById(id: string): Promise<BaselineRecord | null> {
    const row = await this.prisma.baseline.findUnique({ where: { id } });
    return row ? baselineFromRow(row) : null;
  }

  async findActive(providerKey: ProviderKey, endpointKey: string, contextKey: string): Promise<BaselineRecord | null> {
    const row = await this.prisma.baseline.findFirst({
      where: { providerKey, endpointKey, contextKey, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    return row ? baselineFromRow(row) : null;
  }

  async list(filter: BaselineListFilter): Promise<{ rows: BaselineRecord[]; total: number }> {
    const where: Prisma.BaselineWhereInput = {
      ...(filter.provider ? { providerKey: filter.provider } : {}),
      ...(filter.endpoint ? { endpointKey: filter.endpoint } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.baseline.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: filter.limit, skip: filter.offset }),
      this.prisma.baseline.count({ where }),
    ]);
    return { rows: rows.map(baselineFromRow), total };
  }

  async transition(id: string, patch: BaselineTransition, audit: AuditEntry): Promise<BaselineRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.baseline.update({ where: { id }, data: patch });
      await appendAudit(tx, 'BASELINE', id, audit);
      return baselineFromRow(row);
    });
  }

  async promote(id: string, actor: string, now: Date): Promise<BaselineRecord> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.baseline.findUniqueOrThrow({ where: { id } });
      const superseded = await tx.baseline.updateMany({
        where: { providerKey: target.providerKey, endpointKey: target.endpointKey, contextKey: target.contextKey, status: 'ACTIVE', id: { not: id } },
        data: { status: 'SUPERSEDED', supersededAt: now },
      });
      const row = await tx.baseline.update({ where: { id }, data: { status: 'ACTIVE', activatedAt: now, promotedBy: actor, supersededAt: null } });
      await appendAudit(tx, 'BASELINE', id, { action: 'baseline.promoted', actor, details: { version: row.version, superseded: superseded.count } });
      return baselineFromRow(row);
    });
  }
}

export class PrismaFindingStore implements FindingStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findByFingerprint(baselineId: string, fingerprint: string): Promise<FindingRecord | null> {
    const row = await this.prisma.finding.findUnique({ where: { baselineId_fingerprint: { baselineId, fingerprint } } });
    return row ? findingFromRow(row) : null;
  }

  async create(input: NewFinding): Promise<FindingRecord> {
    const { seenAt, observationId, evidence, ...rest } = input;
    const row = await this.prisma.finding.create({
      data: { ...rest, observationId, evidence: toJson(evidence), observationIds: [observationId], firstSeenAt: seenAt, lastSeenAt: seenAt },
    });
    return findingFromRow(row);
  }

  async recordRecurrence(id: string, u: FindingRecurrence): Promise<FindingRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.finding.findUniqueOrThrow({ where: { id }, select: { observationIds: true } });
      const ids = Array.isArray(current.observationIds) ? (current.observationIds as string[]) : [];
      const row = await tx.finding.update({
        where: { id },
        data: {
          severity: u.severity,
          confidence: u.confidence,
          summary: u.summary,
          evidence: toJson(u.evidence),
          lastSeenAt: u.seenAt,
          occurrenceCount: { increment: 1 },
          observationIds: [...ids, u.observationId].slice(-MAX_OBSERVATION_REFS),
          ...(u.reopen ? { status: 'OPEN', resolvedAt: null, statusNote: 'reopened: recurred after resolution', statusChangedBy: 'system', statusChangedAt: u.seenAt } : {}),
        },
      });
      return findingFromRow(row);
    });
  }

  async findById(id: string): Promise<FindingRecord | null> {
    const row = await this.prisma.finding.findUnique({ where: { id } });
    return row ? findingFromRow(row) : null;
  }

  async list(filter: FindingListFilter): Promise<{ rows: FindingRecord[]; total: number }> {
    const where: Prisma.FindingWhereInput = {
      ...(filter.provider ? { providerKey: filter.provider } : {}),
      ...(filter.endpoint ? { endpointKey: filter.endpoint } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.rule ? { rule: filter.rule } : {}),
      ...(filter.baselineId ? { baselineId: filter.baselineId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.finding.findMany({ where, orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }], take: filter.limit, skip: filter.offset }),
      this.prisma.finding.count({ where }),
    ]);
    return { rows: rows.map(findingFromRow), total };
  }

  async setStatus(id: string, change: FindingStatusChange, audit: AuditEntry): Promise<FindingRecord> {
    const resolved = change.status === 'RESOLVED' || change.status === 'FALSE_POSITIVE' || change.status === 'DISMISSED';
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.finding.update({
        where: { id },
        data: { status: change.status, resolvedAt: resolved ? change.now : null, statusNote: change.note ?? null, statusChangedBy: change.actor, statusChangedAt: change.now },
      });
      await appendAudit(tx, 'FINDING', id, audit);
      return findingFromRow(row);
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests)
// ---------------------------------------------------------------------------

export class InMemoryBaselineStore implements BaselineStore {
  readonly rows: BaselineRecord[] = [];
  readonly audit: Array<AuditEntry & { entityId: string }> = [];

  create(input: NewBaseline, audit: AuditEntry): Promise<BaselineRecord> {
    const nodeId = operationNodeKey(input.providerKey, { method: input.endpointKey.split(' ')[0] as never, path: input.endpointKey.split(' ')[1] ?? '' });
    const version = this.rows.filter((r) => r.nodeId === nodeId).length + 1;
    const now = new Date();
    const row: BaselineRecord = {
      id: randomUUID(),
      nodeId,
      version,
      status: 'DRAFT',
      providerKey: input.providerKey,
      endpointKey: input.endpointKey,
      contextKey: input.contextKey,
      summary: structuredClone(input.summary),
      config: structuredClone(input.config),
      sampleCount: input.summary.sampleCount,
      builtFrom: input.builtFrom,
      windowFrom: input.windowFrom,
      windowTo: input.windowTo,
      createdBy: input.createdBy,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      promotedBy: null,
      activatedAt: null,
      supersededAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    this.audit.push({ ...audit, entityId: row.id });
    return Promise.resolve(structuredClone(row));
  }

  findById(id: string): Promise<BaselineRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return Promise.resolve(r ? structuredClone(r) : null);
  }

  findActive(providerKey: ProviderKey, endpointKey: string, contextKey: string): Promise<BaselineRecord | null> {
    const r = [...this.rows].reverse().find((x) => x.providerKey === providerKey && x.endpointKey === endpointKey && x.contextKey === contextKey && x.status === 'ACTIVE');
    return Promise.resolve(r ? structuredClone(r) : null);
  }

  list(filter: BaselineListFilter): Promise<{ rows: BaselineRecord[]; total: number }> {
    const rows = this.rows
      .filter((r) => (!filter.provider || r.providerKey === filter.provider) && (!filter.endpoint || r.endpointKey === filter.endpoint) && (!filter.status || r.status === filter.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.version - a.version);
    return Promise.resolve({ rows: rows.slice(filter.offset, filter.offset + filter.limit).map((r) => structuredClone(r)), total: rows.length });
  }

  transition(id: string, patch: BaselineTransition, audit: AuditEntry): Promise<BaselineRecord> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new Error('baseline not found'));
    Object.assign(r, patch, { updatedAt: new Date() });
    this.audit.push({ ...audit, entityId: id });
    return Promise.resolve(structuredClone(r));
  }

  promote(id: string, actor: string, now: Date): Promise<BaselineRecord> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new Error('baseline not found'));
    for (const o of this.rows) {
      if (o.id !== id && o.providerKey === r.providerKey && o.endpointKey === r.endpointKey && o.contextKey === r.contextKey && o.status === 'ACTIVE') {
        o.status = 'SUPERSEDED';
        o.supersededAt = now;
      }
    }
    Object.assign(r, { status: 'ACTIVE', activatedAt: now, promotedBy: actor, supersededAt: null, updatedAt: now });
    this.audit.push({ action: 'baseline.promoted', actor, entityId: id });
    return Promise.resolve(structuredClone(r));
  }
}

export class InMemoryFindingStore implements FindingStore {
  readonly rows: FindingRecord[] = [];
  readonly audit: Array<AuditEntry & { entityId: string }> = [];

  findByFingerprint(baselineId: string, fingerprint: string): Promise<FindingRecord | null> {
    const r = this.rows.find((x) => x.baselineId === baselineId && x.fingerprint === fingerprint);
    return Promise.resolve(r ? structuredClone(r) : null);
  }

  create(input: NewFinding): Promise<FindingRecord> {
    const { seenAt, ...rest } = input;
    const row: FindingRecord = {
      ...rest,
      id: randomUUID(),
      status: 'OPEN',
      observationIds: [input.observationId],
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      occurrenceCount: 1,
      resolvedAt: null,
      statusNote: null,
      statusChangedBy: null,
      statusChangedAt: null,
      createdAt: seenAt,
      updatedAt: seenAt,
    };
    this.rows.push(row);
    return Promise.resolve(structuredClone(row));
  }

  recordRecurrence(id: string, u: FindingRecurrence): Promise<FindingRecord> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new Error('finding not found'));
    r.severity = u.severity;
    r.confidence = u.confidence;
    r.summary = u.summary;
    r.evidence = u.evidence;
    r.lastSeenAt = u.seenAt;
    r.occurrenceCount += 1;
    r.observationIds = [...r.observationIds, u.observationId].slice(-MAX_OBSERVATION_REFS);
    if (u.reopen) Object.assign(r, { status: 'OPEN', resolvedAt: null, statusNote: 'reopened: recurred after resolution', statusChangedBy: 'system', statusChangedAt: u.seenAt });
    r.updatedAt = u.seenAt;
    return Promise.resolve(structuredClone(r));
  }

  findById(id: string): Promise<FindingRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return Promise.resolve(r ? structuredClone(r) : null);
  }

  list(f: FindingListFilter): Promise<{ rows: FindingRecord[]; total: number }> {
    const rows = this.rows
      .filter(
        (r) =>
          (!f.provider || r.providerKey === f.provider) &&
          (!f.endpoint || r.endpointKey === f.endpoint) &&
          (!f.status || r.status === f.status) &&
          (!f.severity || r.severity === f.severity) &&
          (!f.category || r.category === f.category) &&
          (!f.kind || r.kind === f.kind) &&
          (!f.rule || r.rule === f.rule) &&
          (!f.baselineId || r.baselineId === f.baselineId),
      )
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || b.id.localeCompare(a.id));
    return Promise.resolve({ rows: rows.slice(f.offset, f.offset + f.limit).map((r) => structuredClone(r)), total: rows.length });
  }

  setStatus(id: string, change: FindingStatusChange, audit: AuditEntry): Promise<FindingRecord> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new Error('finding not found'));
    const resolved = change.status === 'RESOLVED' || change.status === 'FALSE_POSITIVE' || change.status === 'DISMISSED';
    Object.assign(r, { status: change.status, resolvedAt: resolved ? change.now : null, statusNote: change.note ?? null, statusChangedBy: change.actor, statusChangedAt: change.now, updatedAt: change.now });
    this.audit.push({ ...audit, entityId: id });
    return Promise.resolve(structuredClone(r));
  }
}
