import { randomUUID } from 'node:crypto';
import type { ExecutionSource, Prisma, ProposalStatus, RepairExecution, RepairKind, RepairProposal, RepairRule, RepairRuleStatus, RepairVersion, RepairVersionStatus, RiskLevel } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { DbClient } from '../db/types.js';
import { checksumSpec } from '../db/repositories/repair.repository.js';
import { repairRuleSpecSchema, type RepairRuleSpec, type Transform, type Policy } from './schemas.js';
import type { Rejection, TraceStep } from './engine.js';

export interface RuleRecord {
  id: string;
  key: string;
  version: number;
  status: RepairRuleStatus;
  spec: RepairRuleSpec;
  checksum: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  retiredAt: Date | null;
  createdAt: Date;
}

export interface AuditEntry {
  action: string;
  actor: string;
  details?: Record<string, unknown>;
}

export interface RuleStore {
  /** Appends the next version for `spec.key`. */
  register(spec: RepairRuleSpec, createdBy: string, audit: AuditEntry): Promise<RuleRecord>;
  findById(id: string): Promise<RuleRecord | null>;
  find(key: string, version: number): Promise<RuleRecord | null>;
  list(filter: { provider?: string; status?: RepairRuleStatus; key?: string; limit: number; offset: number }): Promise<{ rows: RuleRecord[]; total: number }>;
  listApproved(): Promise<RuleRecord[]>;
  setStatus(id: string, status: RepairRuleStatus, actor: string, now: Date, audit: AuditEntry): Promise<RuleRecord>;
}

/** The concrete, immutable transform a proposal carries. */
export interface RepairSpec {
  ruleKey: string | null;
  ruleVersion: number | null;
  adapterKey: string;
  endpointKey: string;
  transforms: Transform[];
  policy: Policy;
}

export interface VersionRecord {
  id: string;
  proposalId: string;
  version: number;
  status: RepairVersionStatus;
  spec: RepairSpec;
  checksum: string;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
}

export interface ProposalRecord {
  id: string;
  findingId: string;
  kind: RepairKind;
  status: ProposalStatus;
  risk: RiskLevel;
  rationale: string;
  preconditions: Array<Record<string, unknown>>;
  requiresHumanReview: boolean;
  blockedReason: string | null;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  ruleKey: string | null;
  ruleVersion: number | null;
  derived: boolean;
  impactReportId: string | null;
  adapterKey: string | null;
  endpointKey: string | null;
  matchEvidence: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProposal {
  findingId: string;
  kind: RepairKind;
  risk: RiskLevel;
  rationale: string;
  preconditions: Array<Record<string, unknown>>;
  requiresHumanReview: boolean;
  blockedReason?: string;
  status: ProposalStatus;
  createdBy: string;
  ruleKey?: string;
  ruleVersion?: number;
  derived: boolean;
  impactReportId?: string;
  adapterKey?: string;
  endpointKey?: string;
  matchEvidence: Record<string, unknown>;
  /** Omitted for MANUAL_REVIEW / blocked proposals. */
  spec?: RepairSpec;
}

export interface ExecutionRecord {
  id: string;
  proposalId: string;
  repairVersionId: string;
  source: ExecutionSource;
  observationId: string | null;
  inputHash: string;
  outputHash: string | null;
  ok: boolean;
  output: unknown;
  rejections: Rejection[];
  trace: TraceStep[];
  contractValid: boolean | null;
  durationMs: number;
  executedBy: string;
  createdAt: Date;
}

export interface ProposalPatch {
  status?: ProposalStatus;
  blockedReason?: string | null;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string | null;
  preconditions?: Array<Record<string, unknown>>;
}

export interface ProposalStore {
  create(input: NewProposal, audit: AuditEntry): Promise<{ proposal: ProposalRecord; version: VersionRecord | null }>;
  findById(id: string): Promise<ProposalRecord | null>;
  list(filter: { findingId?: string; status?: ProposalStatus; adapterKey?: string; limit: number; offset: number }): Promise<{ rows: ProposalRecord[]; total: number }>;
  update(id: string, patch: ProposalPatch, audit: AuditEntry): Promise<ProposalRecord>;
  latestVersion(proposalId: string): Promise<VersionRecord | null>;
  findVersionById(id: string): Promise<VersionRecord | null>;
  listVersions(proposalId: string): Promise<VersionRecord[]>;
  setVersionStatus(versionId: string, status: RepairVersionStatus): Promise<VersionRecord>;
  /** Atomically activate a version, supersede other ACTIVE versions for the same adapter/endpoint, set proposal ACTIVE. */
  activate(proposalId: string, versionId: string, actor: string, now: Date): Promise<{ proposal: ProposalRecord; version: VersionRecord; superseded: number }>;
  /** ACTIVE version for an adapter endpoint, if any. */
  findActiveVersion(adapterKey: string, endpointKey: string): Promise<VersionRecord | null>;
  recordExecution(input: Omit<ExecutionRecord, 'id' | 'createdAt'>, audit: AuditEntry): Promise<ExecutionRecord>;
  listExecutions(proposalId: string, limit: number): Promise<ExecutionRecord[]>;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
function ruleFromRow(r: RepairRule): RuleRecord {
  return { id: r.id, key: r.key, version: r.version, status: r.status, spec: r.spec as RepairRuleSpec, checksum: r.checksum, createdBy: r.createdBy, approvedBy: r.approvedBy, approvedAt: r.approvedAt, retiredAt: r.retiredAt, createdAt: r.createdAt };
}
function proposalFromRow(r: RepairProposal): ProposalRecord {
  return {
    id: r.id,
    findingId: r.findingId,
    kind: r.kind,
    status: r.status,
    risk: r.risk,
    rationale: r.rationale,
    preconditions: Array.isArray(r.preconditions) ? (r.preconditions as Array<Record<string, unknown>>) : [],
    requiresHumanReview: r.requiresHumanReview,
    blockedReason: r.blockedReason,
    createdBy: r.createdBy,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    reviewNote: r.reviewNote,
    ruleKey: r.ruleKey,
    ruleVersion: r.ruleVersion,
    derived: r.derived,
    impactReportId: r.impactReportId,
    adapterKey: r.adapterKey,
    endpointKey: r.endpointKey,
    matchEvidence: (r.matchEvidence as Record<string, unknown> | null) ?? {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
function versionFromRow(r: RepairVersion): VersionRecord {
  return { id: r.id, proposalId: r.proposalId, version: r.version, status: r.status, spec: r.spec as unknown as RepairSpec, checksum: r.checksum, activatedAt: r.activatedAt, deactivatedAt: r.deactivatedAt, createdAt: r.createdAt };
}
function executionFromRow(r: RepairExecution): ExecutionRecord {
  return {
    id: r.id,
    proposalId: r.proposalId,
    repairVersionId: r.repairVersionId,
    source: r.source,
    observationId: r.observationId,
    inputHash: r.inputHash,
    outputHash: r.outputHash,
    ok: r.ok,
    output: r.output,
    rejections: (r.rejections as Rejection[] | null) ?? [],
    trace: (r.trace as TraceStep[] | null) ?? [],
    contractValid: r.contractValid,
    durationMs: r.durationMs,
    executedBy: r.executedBy,
    createdAt: r.createdAt,
  };
}
async function appendAudit(db: DbClient, entityType: 'REPAIR_RULE' | 'REPAIR_PROPOSAL' | 'REPAIR_VERSION' | 'REPAIR_EXECUTION', entityId: string, audit: AuditEntry): Promise<void> {
  await db.auditEvent.create({
    data: { actorType: audit.actor === 'system' ? 'SYSTEM' : 'USER', actorId: audit.actor, action: audit.action, entityType, entityId, details: toJson(audit.details ?? {}) },
  });
}

export class PrismaRuleStore implements RuleStore {
  constructor(private readonly prisma: PrismaClient) {}
  async register(spec: RepairRuleSpec, createdBy: string, audit: AuditEntry): Promise<RuleRecord> {
    const valid = repairRuleSpecSchema.parse(spec);
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.repairRule.findFirst({ where: { key: valid.key }, orderBy: { version: 'desc' }, select: { version: true } });
      const row = await tx.repairRule.create({ data: { key: valid.key, version: (latest?.version ?? 0) + 1, spec: toJson(valid), checksum: checksumSpec(toJson(valid)), createdBy } });
      await appendAudit(tx, 'REPAIR_RULE', row.id, audit);
      return ruleFromRow(row);
    });
  }
  async findById(id: string): Promise<RuleRecord | null> {
    const r = await this.prisma.repairRule.findUnique({ where: { id } });
    return r ? ruleFromRow(r) : null;
  }
  async find(key: string, version: number): Promise<RuleRecord | null> {
    const r = await this.prisma.repairRule.findUnique({ where: { key_version: { key, version } } });
    return r ? ruleFromRow(r) : null;
  }
  async list(f: { provider?: string; status?: RepairRuleStatus; key?: string; limit: number; offset: number }): Promise<{ rows: RuleRecord[]; total: number }> {
    const where: Prisma.RepairRuleWhereInput = { ...(f.status ? { status: f.status } : {}), ...(f.key ? { key: f.key } : {}), ...(f.provider ? { spec: { path: ['scope', 'provider'], equals: f.provider } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.repairRule.findMany({ where, orderBy: [{ key: 'asc' }, { version: 'desc' }], take: f.limit, skip: f.offset }), this.prisma.repairRule.count({ where })]);
    return { rows: rows.map(ruleFromRow), total };
  }
  async listApproved(): Promise<RuleRecord[]> {
    return (await this.prisma.repairRule.findMany({ where: { status: 'APPROVED' }, orderBy: [{ key: 'asc' }, { version: 'desc' }] })).map(ruleFromRow);
  }
  async setStatus(id: string, status: RepairRuleStatus, actor: string, now: Date, audit: AuditEntry): Promise<RuleRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.repairRule.update({ where: { id }, data: status === 'APPROVED' ? { status, approvedBy: actor, approvedAt: now } : status === 'RETIRED' ? { status, retiredAt: now } : { status } });
      await appendAudit(tx, 'REPAIR_RULE', id, audit);
      return ruleFromRow(row);
    });
  }
}

export class PrismaProposalStore implements ProposalStore {
  constructor(private readonly prisma: PrismaClient) {}
  async create(input: NewProposal, audit: AuditEntry): Promise<{ proposal: ProposalRecord; version: VersionRecord | null }> {
    return this.prisma.$transaction(async (tx) => {
      const { spec, ...rest } = input;
      const row = await tx.repairProposal.create({ data: { ...rest, preconditions: toJson(rest.preconditions), matchEvidence: toJson(rest.matchEvidence), blockedReason: rest.blockedReason ?? null } });
      let version: VersionRecord | null = null;
      if (spec) {
        const v = await tx.repairVersion.create({ data: { proposalId: row.id, version: 1, spec: toJson(spec), checksum: checksumSpec(toJson(spec)) } });
        version = versionFromRow(v);
      }
      await appendAudit(tx, 'REPAIR_PROPOSAL', row.id, audit);
      return { proposal: proposalFromRow(row), version };
    });
  }
  async findById(id: string): Promise<ProposalRecord | null> {
    const r = await this.prisma.repairProposal.findUnique({ where: { id } });
    return r ? proposalFromRow(r) : null;
  }
  async list(f: { findingId?: string; status?: ProposalStatus; adapterKey?: string; limit: number; offset: number }): Promise<{ rows: ProposalRecord[]; total: number }> {
    const where: Prisma.RepairProposalWhereInput = { ...(f.findingId ? { findingId: f.findingId } : {}), ...(f.status ? { status: f.status } : {}), ...(f.adapterKey ? { adapterKey: f.adapterKey } : {}) };
    const [rows, total] = await Promise.all([this.prisma.repairProposal.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), this.prisma.repairProposal.count({ where })]);
    return { rows: rows.map(proposalFromRow), total };
  }
  async update(id: string, patch: ProposalPatch, audit: AuditEntry): Promise<ProposalRecord> {
    return this.prisma.$transaction(async (tx) => {
      const { preconditions, ...rest } = patch;
      const row = await tx.repairProposal.update({ where: { id }, data: { ...rest, ...(preconditions ? { preconditions: toJson(preconditions) } : {}) } });
      await appendAudit(tx, 'REPAIR_PROPOSAL', id, audit);
      return proposalFromRow(row);
    });
  }
  async latestVersion(proposalId: string): Promise<VersionRecord | null> {
    const r = await this.prisma.repairVersion.findFirst({ where: { proposalId }, orderBy: { version: 'desc' } });
    return r ? versionFromRow(r) : null;
  }
  async findVersionById(id: string): Promise<VersionRecord | null> {
    const r = await this.prisma.repairVersion.findUnique({ where: { id } });
    return r ? versionFromRow(r) : null;
  }
  async listVersions(proposalId: string): Promise<VersionRecord[]> {
    return (await this.prisma.repairVersion.findMany({ where: { proposalId }, orderBy: { version: 'desc' } })).map(versionFromRow);
  }
  async setVersionStatus(versionId: string, status: RepairVersionStatus): Promise<VersionRecord> {
    return versionFromRow(await this.prisma.repairVersion.update({ where: { id: versionId }, data: { status } }));
  }
  async activate(proposalId: string, versionId: string, actor: string, now: Date): Promise<{ proposal: ProposalRecord; version: VersionRecord; superseded: number }> {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.repairProposal.findUniqueOrThrow({ where: { id: proposalId } });
      const others = await tx.repairVersion.findMany({ where: { status: 'ACTIVE', id: { not: versionId }, proposal: { adapterKey: p.adapterKey, endpointKey: p.endpointKey } }, select: { id: true, proposalId: true } });
      for (const o of others) {
        await tx.repairVersion.update({ where: { id: o.id }, data: { status: 'SUPERSEDED', deactivatedAt: now } });
        await tx.repairProposal.update({ where: { id: o.proposalId }, data: { status: 'ROLLED_BACK' } });
      }
      const version = await tx.repairVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', activatedAt: now, deactivatedAt: null } });
      const proposal = await tx.repairProposal.update({ where: { id: proposalId }, data: { status: 'ACTIVE' } });
      await appendAudit(tx, 'REPAIR_VERSION', versionId, { action: 'repair.activated', actor, details: { proposalId, superseded: others.length } });
      return { proposal: proposalFromRow(proposal), version: versionFromRow(version), superseded: others.length };
    });
  }
  async findActiveVersion(adapterKey: string, endpointKey: string): Promise<VersionRecord | null> {
    const r = await this.prisma.repairVersion.findFirst({ where: { status: 'ACTIVE', proposal: { adapterKey, endpointKey } }, orderBy: { activatedAt: 'desc' } });
    return r ? versionFromRow(r) : null;
  }
  async recordExecution(input: Omit<ExecutionRecord, 'id' | 'createdAt'>, audit: AuditEntry): Promise<ExecutionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.repairExecution.create({
        data: { ...input, output: input.output === null || input.output === undefined ? undefined : toJson(input.output), rejections: toJson(input.rejections), trace: toJson(input.trace) },
      });
      await appendAudit(tx, 'REPAIR_EXECUTION', row.id, audit);
      return executionFromRow(row);
    });
  }
  async listExecutions(proposalId: string, limit: number): Promise<ExecutionRecord[]> {
    return (await this.prisma.repairExecution.findMany({ where: { proposalId }, orderBy: { createdAt: 'desc' }, take: limit })).map(executionFromRow);
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests)
// ---------------------------------------------------------------------------

export class InMemoryRuleStore implements RuleStore {
  readonly rows: RuleRecord[] = [];
  readonly audit: Array<AuditEntry & { entityId: string }> = [];
  register(spec: RepairRuleSpec, createdBy: string, audit: AuditEntry): Promise<RuleRecord> {
    const valid = repairRuleSpecSchema.parse(spec);
    const version = this.rows.filter((r) => r.key === valid.key).length + 1;
    const row: RuleRecord = { id: randomUUID(), key: valid.key, version, status: 'DRAFT', spec: structuredClone(valid), checksum: checksumSpec(JSON.parse(JSON.stringify(valid)) as Prisma.InputJsonValue), createdBy, approvedBy: null, approvedAt: null, retiredAt: null, createdAt: new Date() };
    this.rows.push(row);
    this.audit.push({ ...audit, entityId: row.id });
    return Promise.resolve(structuredClone(row));
  }
  findById(id: string): Promise<RuleRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
  find(key: string, version: number): Promise<RuleRecord | null> {
    const r = this.rows.find((x) => x.key === key && x.version === version);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
  list(f: { provider?: string; status?: RepairRuleStatus; key?: string; limit: number; offset: number }): Promise<{ rows: RuleRecord[]; total: number }> {
    const rows = this.rows.filter((r) => (!f.status || r.status === f.status) && (!f.key || r.key === f.key) && (!f.provider || r.spec.scope.provider === f.provider)).sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version);
    return Promise.resolve({ rows: rows.slice(f.offset, f.offset + f.limit).map((r) => structuredClone(r)), total: rows.length });
  }
  listApproved(): Promise<RuleRecord[]> {
    return Promise.resolve(this.rows.filter((r) => r.status === 'APPROVED').map((r) => structuredClone(r)));
  }
  setStatus(id: string, status: RepairRuleStatus, actor: string, now: Date, audit: AuditEntry): Promise<RuleRecord> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new Error('rule not found'));
    r.status = status;
    if (status === 'APPROVED') Object.assign(r, { approvedBy: actor, approvedAt: now });
    if (status === 'RETIRED') r.retiredAt = now;
    this.audit.push({ ...audit, entityId: id });
    return Promise.resolve(structuredClone(r));
  }
}

export class InMemoryProposalStore implements ProposalStore {
  readonly proposals: ProposalRecord[] = [];
  readonly versions: VersionRecord[] = [];
  readonly executions: ExecutionRecord[] = [];
  readonly audit: Array<AuditEntry & { entityId: string }> = [];

  create(input: NewProposal, audit: AuditEntry): Promise<{ proposal: ProposalRecord; version: VersionRecord | null }> {
    const now = new Date();
    const { spec, ...rest } = input;
    const proposal: ProposalRecord = {
      id: randomUUID(),
      ...rest,
      blockedReason: rest.blockedReason ?? null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      ruleKey: rest.ruleKey ?? null,
      ruleVersion: rest.ruleVersion ?? null,
      impactReportId: rest.impactReportId ?? null,
      adapterKey: rest.adapterKey ?? null,
      endpointKey: rest.endpointKey ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.proposals.push(proposal);
    let version: VersionRecord | null = null;
    if (spec) {
      version = { id: randomUUID(), proposalId: proposal.id, version: 1, status: 'CANDIDATE', spec: structuredClone(spec), checksum: checksumSpec(JSON.parse(JSON.stringify(spec)) as Prisma.InputJsonValue), activatedAt: null, deactivatedAt: null, createdAt: now };
      this.versions.push(version);
    }
    this.audit.push({ ...audit, entityId: proposal.id });
    return Promise.resolve({ proposal: structuredClone(proposal), version: version ? structuredClone(version) : null });
  }
  findById(id: string): Promise<ProposalRecord | null> {
    const p = this.proposals.find((x) => x.id === id);
    return Promise.resolve(p ? structuredClone(p) : null);
  }
  list(f: { findingId?: string; status?: ProposalStatus; adapterKey?: string; limit: number; offset: number }): Promise<{ rows: ProposalRecord[]; total: number }> {
    const rows = this.proposals.filter((p) => (!f.findingId || p.findingId === f.findingId) && (!f.status || p.status === f.status) && (!f.adapterKey || p.adapterKey === f.adapterKey)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve({ rows: rows.slice(f.offset, f.offset + f.limit).map((r) => structuredClone(r)), total: rows.length });
  }
  update(id: string, patch: ProposalPatch, audit: AuditEntry): Promise<ProposalRecord> {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return Promise.reject(new Error('proposal not found'));
    Object.assign(p, patch, { updatedAt: new Date() });
    this.audit.push({ ...audit, entityId: id });
    return Promise.resolve(structuredClone(p));
  }
  latestVersion(proposalId: string): Promise<VersionRecord | null> {
    const v = [...this.versions].filter((x) => x.proposalId === proposalId).sort((a, b) => b.version - a.version)[0];
    return Promise.resolve(v ? structuredClone(v) : null);
  }
  findVersionById(id: string): Promise<VersionRecord | null> {
    const v = this.versions.find((x) => x.id === id);
    return Promise.resolve(v ? structuredClone(v) : null);
  }
  listVersions(proposalId: string): Promise<VersionRecord[]> {
    return Promise.resolve(this.versions.filter((x) => x.proposalId === proposalId).sort((a, b) => b.version - a.version).map((v) => structuredClone(v)));
  }
  setVersionStatus(versionId: string, status: RepairVersionStatus): Promise<VersionRecord> {
    const v = this.versions.find((x) => x.id === versionId);
    if (!v) return Promise.reject(new Error('version not found'));
    v.status = status;
    return Promise.resolve(structuredClone(v));
  }
  activate(proposalId: string, versionId: string, actor: string, now: Date): Promise<{ proposal: ProposalRecord; version: VersionRecord; superseded: number }> {
    const p = this.proposals.find((x) => x.id === proposalId);
    const v = this.versions.find((x) => x.id === versionId);
    if (!p || !v) return Promise.reject(new Error('not found'));
    let superseded = 0;
    for (const other of this.versions) {
      const op = this.proposals.find((x) => x.id === other.proposalId);
      if (other.id !== versionId && other.status === 'ACTIVE' && op && op.adapterKey === p.adapterKey && op.endpointKey === p.endpointKey) {
        other.status = 'SUPERSEDED';
        other.deactivatedAt = now;
        op.status = 'ROLLED_BACK';
        superseded += 1;
      }
    }
    Object.assign(v, { status: 'ACTIVE', activatedAt: now, deactivatedAt: null });
    Object.assign(p, { status: 'ACTIVE', updatedAt: now });
    this.audit.push({ action: 'repair.activated', actor, entityId: versionId, details: { proposalId, superseded } });
    return Promise.resolve({ proposal: structuredClone(p), version: structuredClone(v), superseded });
  }
  findActiveVersion(adapterKey: string, endpointKey: string): Promise<VersionRecord | null> {
    const v = this.versions.find((x) => {
      const p = this.proposals.find((y) => y.id === x.proposalId);
      return x.status === 'ACTIVE' && p?.adapterKey === adapterKey && p?.endpointKey === endpointKey;
    });
    return Promise.resolve(v ? structuredClone(v) : null);
  }
  recordExecution(input: Omit<ExecutionRecord, 'id' | 'createdAt'>, audit: AuditEntry): Promise<ExecutionRecord> {
    const row: ExecutionRecord = { ...structuredClone(input), id: randomUUID(), createdAt: new Date() };
    this.executions.push(row);
    this.audit.push({ ...audit, entityId: row.id });
    return Promise.resolve(structuredClone(row));
  }
  listExecutions(proposalId: string, limit: number): Promise<ExecutionRecord[]> {
    return Promise.resolve(this.executions.filter((e) => e.proposalId === proposalId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map((e) => structuredClone(e)));
  }
}
