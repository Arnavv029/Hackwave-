import { randomUUID } from 'node:crypto';
import type { AiProposal, AiProposalStatus, Prisma, RiskLevel } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { Transform } from '../repair/schemas.js';
import type { AiProposalOutput } from './schemas.js';
import type { PolicyIssue } from './policy.js';

export interface AiProposalRecord {
  id: string;
  findingId: string;
  version: number;
  status: AiProposalStatus;
  provider: string;
  model: string;
  requestId: string | null;
  usage: Record<string, unknown> | null;
  latencyMs: number | null;
  attempts: number;
  inputRefs: Record<string, unknown>;
  proposal: AiProposalOutput | null;
  compiledTransform: Transform | null;
  policyIssues: PolicyIssue[];
  validation: Record<string, unknown> | null;
  risk: RiskLevel;
  requiresHumanReview: boolean;
  errorCategory: string | null;
  errorMessage: string | null;
  ruleId: string | null;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAiProposal = Omit<AiProposalRecord, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'reviewedBy' | 'reviewedAt' | 'reviewNote' | 'ruleId'>;

export interface AuditEntry {
  action: string;
  actor: string;
  details?: Record<string, unknown>;
}

export interface AiProposalStore {
  create(input: NewAiProposal, audit: AuditEntry): Promise<AiProposalRecord>;
  findById(id: string): Promise<AiProposalRecord | null>;
  list(filter: { findingId?: string; status?: AiProposalStatus; limit: number; offset: number }): Promise<{ rows: AiProposalRecord[]; total: number }>;
  update(id: string, patch: { status?: AiProposalStatus; ruleId?: string; reviewedBy?: string; reviewedAt?: Date; reviewNote?: string | null }, audit: AuditEntry): Promise<AiProposalRecord>;
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
function fromRow(r: AiProposal): AiProposalRecord {
  return {
    id: r.id,
    findingId: r.findingId,
    version: r.version,
    status: r.status,
    provider: r.provider,
    model: r.model,
    requestId: r.requestId,
    usage: (r.usage as Record<string, unknown> | null) ?? null,
    latencyMs: r.latencyMs,
    attempts: r.attempts,
    inputRefs: (r.inputRefs as Record<string, unknown> | null) ?? {},
    proposal: (r.proposal as AiProposalOutput | null) ?? null,
    compiledTransform: (r.compiledTransform as Transform | null) ?? null,
    policyIssues: (r.policyIssues as PolicyIssue[] | null) ?? [],
    validation: (r.validation as Record<string, unknown> | null) ?? null,
    risk: r.risk,
    requiresHumanReview: r.requiresHumanReview,
    errorCategory: r.errorCategory,
    errorMessage: r.errorMessage,
    ruleId: r.ruleId,
    createdBy: r.createdBy,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    reviewNote: r.reviewNote,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PrismaAiProposalStore implements AiProposalStore {
  constructor(private readonly prisma: PrismaClient) {}
  async create(input: NewAiProposal, audit: AuditEntry): Promise<AiProposalRecord> {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.aiProposal.findFirst({ where: { findingId: input.findingId }, orderBy: { version: 'desc' }, select: { version: true } });
      const row = await tx.aiProposal.create({
        data: {
          ...input,
          version: (latest?.version ?? 0) + 1,
          usage: input.usage ? toJson(input.usage) : undefined,
          inputRefs: toJson(input.inputRefs),
          proposal: input.proposal ? toJson(input.proposal) : undefined,
          compiledTransform: input.compiledTransform ? toJson(input.compiledTransform) : undefined,
          policyIssues: toJson(input.policyIssues),
          validation: input.validation ? toJson(input.validation) : undefined,
        },
      });
      await tx.auditEvent.create({ data: { actorType: audit.actor === 'system' ? 'SYSTEM' : 'USER', actorId: audit.actor, action: audit.action, entityType: 'AI_PROPOSAL', entityId: row.id, details: toJson(audit.details ?? {}) } });
      return fromRow(row);
    });
  }
  async findById(id: string): Promise<AiProposalRecord | null> {
    const r = await this.prisma.aiProposal.findUnique({ where: { id } });
    return r ? fromRow(r) : null;
  }
  async list(f: { findingId?: string; status?: AiProposalStatus; limit: number; offset: number }): Promise<{ rows: AiProposalRecord[]; total: number }> {
    const where: Prisma.AiProposalWhereInput = { ...(f.findingId ? { findingId: f.findingId } : {}), ...(f.status ? { status: f.status } : {}) };
    const [rows, total] = await Promise.all([this.prisma.aiProposal.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), this.prisma.aiProposal.count({ where })]);
    return { rows: rows.map(fromRow), total };
  }
  async update(id: string, patch: { status?: AiProposalStatus; ruleId?: string; reviewedBy?: string; reviewedAt?: Date; reviewNote?: string | null }, audit: AuditEntry): Promise<AiProposalRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.aiProposal.update({ where: { id }, data: patch });
      await tx.auditEvent.create({ data: { actorType: 'USER', actorId: audit.actor, action: audit.action, entityType: 'AI_PROPOSAL', entityId: id, details: toJson(audit.details ?? {}) } });
      return fromRow(row);
    });
  }
}

export class InMemoryAiProposalStore implements AiProposalStore {
  readonly rows: AiProposalRecord[] = [];
  readonly audit: Array<AuditEntry & { entityId: string }> = [];
  create(input: NewAiProposal, audit: AuditEntry): Promise<AiProposalRecord> {
    const now = new Date();
    const row: AiProposalRecord = { ...structuredClone(input), id: randomUUID(), version: this.rows.filter((r) => r.findingId === input.findingId).length + 1, ruleId: null, reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: now, updatedAt: now };
    this.rows.push(row);
    this.audit.push({ ...audit, entityId: row.id });
    return Promise.resolve(structuredClone(row));
  }
  findById(id: string): Promise<AiProposalRecord | null> {
    const r = this.rows.find((x) => x.id === id);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
  list(f: { findingId?: string; status?: AiProposalStatus; limit: number; offset: number }): Promise<{ rows: AiProposalRecord[]; total: number }> {
    const rows = this.rows.filter((r) => (!f.findingId || r.findingId === f.findingId) && (!f.status || r.status === f.status)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.version - a.version);
    return Promise.resolve({ rows: rows.slice(f.offset, f.offset + f.limit).map((r) => structuredClone(r)), total: rows.length });
  }
  update(id: string, patch: { status?: AiProposalStatus; ruleId?: string; reviewedBy?: string; reviewedAt?: Date; reviewNote?: string | null }, audit: AuditEntry): Promise<AiProposalRecord> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new Error('ai proposal not found'));
    Object.assign(r, patch, { updatedAt: new Date() });
    this.audit.push({ ...audit, entityId: id });
    return Promise.resolve(structuredClone(r));
  }
}
