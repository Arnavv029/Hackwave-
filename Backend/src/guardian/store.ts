import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { FieldPath } from '../observation/schemas.js';
import type { AdapterSpec } from './adapter.js';
import type { FieldChange, ResponseDiff } from './diff.js';

/**
 * Persistence seam for the monitor engine. Prisma for the server, in-memory
 * for hermetic tests. Both are append-only for checks, incidents' history
 * and audit events.
 */

export type MonitorStatus = 'ACTIVE' | 'PAUSED';
export type MonitorAuthType = 'NONE' | 'BEARER' | 'API_KEY' | 'BASIC';
export type BaselineStatus = 'PENDING' | 'APPROVED' | 'SUPERSEDED' | 'REJECTED';
export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'AWAITING_FIX' | 'RESOLVED';
export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROMOTED' | 'ROLLED_BACK';

export interface MonitorRecord {
  id: string;
  name: string;
  url: string;
  method: string;
  environment: string;
  description: string;
  intervalSec: number;
  timeoutMs: number;
  authType: MonitorAuthType;
  authHeader: string | null;
  authSecretEnc: string | null;
  headers: Record<string, string>;
  body: unknown;
  expectedStatus: number | null;
  autoBaseline: boolean;
  status: MonitorStatus;
  createdBy: string;
  nextRunAt: Date | null;
  lastCheckedAt: Date | null;
  lastOutcome: string | null;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  activeProposalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type NewMonitor = Omit<MonitorRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastCheckedAt' | 'lastOutcome' | 'lastStatusCode' | 'lastLatencyMs' | 'activeProposalId'>;
export type MonitorPatch = Partial<Omit<MonitorRecord, 'id' | 'createdAt' | 'updatedAt'>>;

export interface CheckRecord {
  id: string;
  monitorId: string;
  checkedAt: Date;
  outcome: string;
  statusCode: number | null;
  latencyMs: number;
  responseBytes: number;
  parseOutcome: string;
  bodySample: unknown;
  fieldPaths: FieldPath[] | null;
  shapeHash: string | null;
  errorMessage: string | null;
  diff: ResponseDiff | null;
  adapted: boolean;
  incidentId: string | null;
  triggeredBy: string;
}
export type NewCheck = Omit<CheckRecord, 'id'>;

export interface BaselineRecord {
  id: string;
  monitorId: string;
  version: number;
  status: BaselineStatus;
  checkId: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  snapshot: unknown;
  fieldPaths: FieldPath[];
  shapeHash: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  note: string | null;
  createdAt: Date;
}
export type NewBaseline = Omit<BaselineRecord, 'id' | 'createdAt' | 'version'>;

export interface IncidentRecord {
  id: string;
  monitorId: string;
  baselineId: string | null;
  checkId: string | null;
  fingerprint: string;
  title: string;
  issueType: string;
  severity: string;
  status: IncidentStatus;
  detectedAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  occurrenceCount: number;
  previousResponse: unknown;
  latestResponse: unknown;
  diffs: FieldChange[];
  statusCode: number | null;
  latencyMs: number | null;
  assignee: string | null;
  statusChangedBy: string | null;
  note: string | null;
  updatedAt: Date;
}
export type NewIncident = Omit<IncidentRecord, 'id' | 'updatedAt' | 'detectedAt' | 'lastSeenAt' | 'resolvedAt' | 'occurrenceCount'>;
export type IncidentPatch = Partial<Omit<IncidentRecord, 'id' | 'monitorId' | 'updatedAt'>>;

export interface MappingRecord {
  id: string;
  monitorId: string;
  feature: string;
  jsonPath: string;
  route: string | null;
  impactLevel: string;
  description: string | null;
  symptom: string | null;
  createdBy: string;
  createdAt: Date;
}
export type NewMapping = Omit<MappingRecord, 'id' | 'createdAt'>;

export interface ValidationAssertion {
  rule: string;
  passed: boolean;
  expected: string;
  actual: string;
  mandatory: boolean;
}
export interface ValidationResult {
  runId: string;
  testName: string;
  targetWorkflow: string;
  expectedResult: string;
  actualResult: string;
  status: 'Passed' | 'Failed' | 'Inconclusive';
  latencyMs: number;
  testTime: string;
  assertions: ValidationAssertion[];
  logs: string[];
  adaptedSample: unknown;
  errorDetails?: string;
  executedBy: string;
}

export interface ProposalRecord {
  id: string;
  incidentId: string;
  monitorId: string;
  status: ProposalStatus;
  proposedSolution: string;
  transform: AdapterSpec;
  assumptions: string[];
  risks: string[];
  requiresManualReview: boolean;
  targetEnvironment: string;
  createdBy: string;
  approver: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  promotedBy: string | null;
  promotedAt: Date | null;
  validation: ValidationResult | null;
  createdAt: Date;
  updatedAt: Date;
}
export type NewProposal = Omit<ProposalRecord, 'id' | 'createdAt' | 'updatedAt' | 'approver' | 'approvedAt' | 'rejectedBy' | 'rejectedAt' | 'promotedBy' | 'promotedAt' | 'validation'>;
export type ProposalPatch = Partial<Omit<ProposalRecord, 'id' | 'incidentId' | 'monitorId' | 'createdAt' | 'updatedAt'>>;

export interface AuditRecord {
  id: string;
  actorType: 'SYSTEM' | 'USER' | 'SERVICE';
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: Date;
}
export type NewAudit = Omit<AuditRecord, 'id' | 'createdAt'>;

export interface IncidentFilter {
  monitorId?: string;
  status?: IncidentStatus;
  severity?: string;
  limit: number;
}
export interface ProposalFilter {
  monitorId?: string;
  incidentId?: string;
  status?: ProposalStatus;
  limit: number;
}

export interface GuardianStore {
  createMonitor(input: NewMonitor): Promise<MonitorRecord>;
  updateMonitor(id: string, patch: MonitorPatch): Promise<MonitorRecord>;
  deleteMonitor(id: string): Promise<void>;
  getMonitor(id: string): Promise<MonitorRecord | null>;
  listMonitors(): Promise<MonitorRecord[]>;
  /** ACTIVE monitors whose nextRunAt is due (or null). */
  listDueMonitors(now: Date, limit: number): Promise<MonitorRecord[]>;

  createCheck(input: NewCheck): Promise<CheckRecord>;
  updateCheck(id: string, patch: Partial<Pick<CheckRecord, 'diff' | 'incidentId' | 'adapted'>>): Promise<CheckRecord>;
  getCheck(id: string): Promise<CheckRecord | null>;
  listChecks(monitorId: string, limit: number): Promise<CheckRecord[]>;
  latestCheck(monitorId: string): Promise<CheckRecord | null>;
  /** All checks since a time (bounded) for statistics. */
  listChecksSince(since: Date, limit: number): Promise<CheckRecord[]>;

  createBaseline(input: NewBaseline): Promise<BaselineRecord>;
  updateBaseline(id: string, patch: Partial<Pick<BaselineRecord, 'status' | 'approvedBy' | 'approvedAt' | 'note'>>): Promise<BaselineRecord>;
  getBaseline(id: string): Promise<BaselineRecord | null>;
  listBaselines(monitorId: string): Promise<BaselineRecord[]>;
  approvedBaseline(monitorId: string): Promise<BaselineRecord | null>;

  createIncident(input: NewIncident): Promise<IncidentRecord>;
  updateIncident(id: string, patch: IncidentPatch): Promise<IncidentRecord>;
  getIncident(id: string): Promise<IncidentRecord | null>;
  listIncidents(filter: IncidentFilter): Promise<IncidentRecord[]>;
  findOpenIncident(monitorId: string, fingerprint: string): Promise<IncidentRecord | null>;
  /** Most recent RESOLVED incident with this fingerprint whose resolution is newer than `since` (used to reopen instead of duplicating). */
  findRecentlyResolvedIncident(monitorId: string, fingerprint: string, since: Date): Promise<IncidentRecord | null>;

  createMapping(input: NewMapping): Promise<MappingRecord>;
  deleteMapping(id: string): Promise<void>;
  getMapping(id: string): Promise<MappingRecord | null>;
  listMappings(monitorId?: string): Promise<MappingRecord[]>;

  createProposal(input: NewProposal): Promise<ProposalRecord>;
  updateProposal(id: string, patch: ProposalPatch): Promise<ProposalRecord>;
  getProposal(id: string): Promise<ProposalRecord | null>;
  listProposals(filter: ProposalFilter): Promise<ProposalRecord[]>;

  appendAudit(input: NewAudit): Promise<AuditRecord>;
  listAudit(limit: number, entityType?: string): Promise<AuditRecord[]>;

  getSetting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown, updatedBy: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}
function jsonOrNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  return v === undefined || v === null ? undefined : toJson(v);
}
const AUDIT_TYPES = new Set(['MONITOR', 'MONITOR_BASELINE', 'MONITOR_INCIDENT', 'RECOVERY_PROPOSAL', 'FEATURE_MAPPING', 'SETTINGS']);

export class PrismaGuardianStore implements GuardianStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createMonitor(i: NewMonitor): Promise<MonitorRecord> {
    const row = await this.prisma.monitor.create({
      data: { name: i.name, url: i.url, method: i.method, environment: i.environment, description: i.description, intervalSec: i.intervalSec, timeoutMs: i.timeoutMs, authType: i.authType, authHeader: i.authHeader, authSecretEnc: i.authSecretEnc, headers: toJson(i.headers), body: i.body === undefined || i.body === null ? undefined : toJson(i.body), expectedStatus: i.expectedStatus, autoBaseline: i.autoBaseline, status: i.status, createdBy: i.createdBy, nextRunAt: i.nextRunAt },
    });
    return monitorFromRow(row);
  }
  async updateMonitor(id: string, p: MonitorPatch): Promise<MonitorRecord> {
    const data: Prisma.MonitorUpdateInput = {};
    for (const k of ['name', 'url', 'method', 'environment', 'description', 'intervalSec', 'timeoutMs', 'authType', 'authHeader', 'authSecretEnc', 'expectedStatus', 'autoBaseline', 'status', 'createdBy', 'nextRunAt', 'lastCheckedAt', 'lastOutcome', 'lastStatusCode', 'lastLatencyMs', 'activeProposalId'] as const) {
      if (p[k] !== undefined) (data as Record<string, unknown>)[k] = p[k];
    }
    if (p.headers !== undefined) data.headers = toJson(p.headers);
    if (p.body !== undefined) data.body = p.body === null ? Prisma.DbNull : toJson(p.body);
    const row = await this.prisma.monitor.update({ where: { id }, data });
    return monitorFromRow(row);
  }
  async deleteMonitor(id: string): Promise<void> {
    await this.prisma.monitor.delete({ where: { id } });
  }
  async getMonitor(id: string): Promise<MonitorRecord | null> {
    const row = await this.prisma.monitor.findUnique({ where: { id } });
    return row ? monitorFromRow(row) : null;
  }
  async listMonitors(): Promise<MonitorRecord[]> {
    return (await this.prisma.monitor.findMany({ orderBy: { createdAt: 'desc' } })).map(monitorFromRow);
  }
  async listDueMonitors(now: Date, limit: number): Promise<MonitorRecord[]> {
    return (await this.prisma.monitor.findMany({ where: { status: 'ACTIVE', OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, orderBy: { nextRunAt: 'asc' }, take: limit })).map(monitorFromRow);
  }

  async createCheck(i: NewCheck): Promise<CheckRecord> {
    const row = await this.prisma.monitorCheck.create({
      data: { monitorId: i.monitorId, checkedAt: i.checkedAt, outcome: i.outcome, statusCode: i.statusCode, latencyMs: i.latencyMs, responseBytes: i.responseBytes, parseOutcome: i.parseOutcome, bodySample: jsonOrNull(i.bodySample), fieldPaths: jsonOrNull(i.fieldPaths), shapeHash: i.shapeHash, errorMessage: i.errorMessage, diff: jsonOrNull(i.diff), adapted: i.adapted, incidentId: i.incidentId, triggeredBy: i.triggeredBy },
    });
    return checkFromRow(row);
  }
  async updateCheck(id: string, p: Partial<Pick<CheckRecord, 'diff' | 'incidentId' | 'adapted'>>): Promise<CheckRecord> {
    const row = await this.prisma.monitorCheck.update({ where: { id }, data: { ...(p.diff !== undefined ? { diff: p.diff === null ? Prisma.DbNull : toJson(p.diff) } : {}), ...(p.incidentId !== undefined ? { incidentId: p.incidentId } : {}), ...(p.adapted !== undefined ? { adapted: p.adapted } : {}) } });
    return checkFromRow(row);
  }
  async getCheck(id: string): Promise<CheckRecord | null> {
    const row = await this.prisma.monitorCheck.findUnique({ where: { id } });
    return row ? checkFromRow(row) : null;
  }
  async listChecks(monitorId: string, limit: number): Promise<CheckRecord[]> {
    return (await this.prisma.monitorCheck.findMany({ where: { monitorId }, orderBy: { checkedAt: 'desc' }, take: limit })).map(checkFromRow);
  }
  async latestCheck(monitorId: string): Promise<CheckRecord | null> {
    const row = await this.prisma.monitorCheck.findFirst({ where: { monitorId }, orderBy: { checkedAt: 'desc' } });
    return row ? checkFromRow(row) : null;
  }
  async listChecksSince(since: Date, limit: number): Promise<CheckRecord[]> {
    return (await this.prisma.monitorCheck.findMany({ where: { checkedAt: { gte: since } }, orderBy: { checkedAt: 'desc' }, take: limit })).map(checkFromRow);
  }

  async createBaseline(i: NewBaseline): Promise<BaselineRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const last = await tx.monitorBaseline.findFirst({ where: { monitorId: i.monitorId }, orderBy: { version: 'desc' }, select: { version: true } });
      if (i.status === 'APPROVED') await tx.monitorBaseline.updateMany({ where: { monitorId: i.monitorId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      return tx.monitorBaseline.create({ data: { monitorId: i.monitorId, version: (last?.version ?? 0) + 1, status: i.status, checkId: i.checkId, statusCode: i.statusCode, latencyMs: i.latencyMs, snapshot: toJson(i.snapshot), fieldPaths: toJson(i.fieldPaths), shapeHash: i.shapeHash, approvedBy: i.approvedBy, approvedAt: i.approvedAt, note: i.note } });
    });
    return baselineFromRow(row);
  }
  async updateBaseline(id: string, p: Partial<Pick<BaselineRecord, 'status' | 'approvedBy' | 'approvedAt' | 'note'>>): Promise<BaselineRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const cur = await tx.monitorBaseline.findUniqueOrThrow({ where: { id } });
      if (p.status === 'APPROVED') await tx.monitorBaseline.updateMany({ where: { monitorId: cur.monitorId, status: 'APPROVED', NOT: { id } }, data: { status: 'SUPERSEDED' } });
      return tx.monitorBaseline.update({ where: { id }, data: p });
    });
    return baselineFromRow(row);
  }
  async getBaseline(id: string): Promise<BaselineRecord | null> {
    const row = await this.prisma.monitorBaseline.findUnique({ where: { id } });
    return row ? baselineFromRow(row) : null;
  }
  async listBaselines(monitorId: string): Promise<BaselineRecord[]> {
    return (await this.prisma.monitorBaseline.findMany({ where: { monitorId }, orderBy: { version: 'desc' } })).map(baselineFromRow);
  }
  async approvedBaseline(monitorId: string): Promise<BaselineRecord | null> {
    const row = await this.prisma.monitorBaseline.findFirst({ where: { monitorId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
    return row ? baselineFromRow(row) : null;
  }

  async createIncident(i: NewIncident): Promise<IncidentRecord> {
    const row = await this.prisma.monitorIncident.create({ data: { monitorId: i.monitorId, baselineId: i.baselineId, checkId: i.checkId, fingerprint: i.fingerprint, title: i.title, issueType: i.issueType, severity: i.severity, status: i.status, previousResponse: jsonOrNull(i.previousResponse), latestResponse: jsonOrNull(i.latestResponse), diffs: toJson(i.diffs), statusCode: i.statusCode, latencyMs: i.latencyMs, assignee: i.assignee, statusChangedBy: i.statusChangedBy, note: i.note } });
    return incidentFromRow(row);
  }
  async updateIncident(id: string, p: IncidentPatch): Promise<IncidentRecord> {
    const data: Prisma.MonitorIncidentUpdateInput = {};
    for (const k of ['baselineId', 'checkId', 'fingerprint', 'title', 'issueType', 'severity', 'status', 'detectedAt', 'lastSeenAt', 'resolvedAt', 'occurrenceCount', 'statusCode', 'latencyMs', 'assignee', 'statusChangedBy', 'note'] as const) {
      if (p[k] !== undefined) (data as Record<string, unknown>)[k] = p[k];
    }
    if (p.previousResponse !== undefined) data.previousResponse = p.previousResponse === null ? Prisma.DbNull : toJson(p.previousResponse);
    if (p.latestResponse !== undefined) data.latestResponse = p.latestResponse === null ? Prisma.DbNull : toJson(p.latestResponse);
    if (p.diffs !== undefined) data.diffs = toJson(p.diffs);
    const row = await this.prisma.monitorIncident.update({ where: { id }, data });
    return incidentFromRow(row);
  }
  async getIncident(id: string): Promise<IncidentRecord | null> {
    const row = await this.prisma.monitorIncident.findUnique({ where: { id } });
    return row ? incidentFromRow(row) : null;
  }
  async listIncidents(f: IncidentFilter): Promise<IncidentRecord[]> {
    return (await this.prisma.monitorIncident.findMany({ where: { ...(f.monitorId ? { monitorId: f.monitorId } : {}), ...(f.status ? { status: f.status } : {}), ...(f.severity ? { severity: f.severity } : {}) }, orderBy: { detectedAt: 'desc' }, take: f.limit })).map(incidentFromRow);
  }
  async findOpenIncident(monitorId: string, fingerprint: string): Promise<IncidentRecord | null> {
    const row = await this.prisma.monitorIncident.findFirst({ where: { monitorId, fingerprint, status: { not: 'RESOLVED' } }, orderBy: { detectedAt: 'desc' } });
    return row ? incidentFromRow(row) : null;
  }
  async findRecentlyResolvedIncident(monitorId: string, fingerprint: string, since: Date): Promise<IncidentRecord | null> {
    const row = await this.prisma.monitorIncident.findFirst({ where: { monitorId, fingerprint, status: 'RESOLVED', resolvedAt: { gte: since } }, orderBy: { resolvedAt: 'desc' } });
    return row ? incidentFromRow(row) : null;
  }

  async createMapping(i: NewMapping): Promise<MappingRecord> {
    return mappingFromRow(await this.prisma.featureMapping.create({ data: i }));
  }
  async deleteMapping(id: string): Promise<void> {
    await this.prisma.featureMapping.delete({ where: { id } });
  }
  async getMapping(id: string): Promise<MappingRecord | null> {
    const row = await this.prisma.featureMapping.findUnique({ where: { id } });
    return row ? mappingFromRow(row) : null;
  }
  async listMappings(monitorId?: string): Promise<MappingRecord[]> {
    return (await this.prisma.featureMapping.findMany({ where: monitorId ? { monitorId } : {}, orderBy: { createdAt: 'asc' } })).map(mappingFromRow);
  }

  async createProposal(i: NewProposal): Promise<ProposalRecord> {
    const row = await this.prisma.recoveryProposal.create({ data: { incidentId: i.incidentId, monitorId: i.monitorId, status: i.status, proposedSolution: i.proposedSolution, transform: toJson(i.transform), assumptions: toJson(i.assumptions), risks: toJson(i.risks), requiresManualReview: i.requiresManualReview, targetEnvironment: i.targetEnvironment, createdBy: i.createdBy } });
    return proposalFromRow(row);
  }
  async updateProposal(id: string, p: ProposalPatch): Promise<ProposalRecord> {
    const data: Prisma.RecoveryProposalUpdateInput = {};
    for (const k of ['status', 'proposedSolution', 'requiresManualReview', 'targetEnvironment', 'createdBy', 'approver', 'approvedAt', 'rejectedBy', 'rejectedAt', 'promotedBy', 'promotedAt'] as const) {
      if (p[k] !== undefined) (data as Record<string, unknown>)[k] = p[k];
    }
    if (p.transform !== undefined) data.transform = toJson(p.transform);
    if (p.assumptions !== undefined) data.assumptions = toJson(p.assumptions);
    if (p.risks !== undefined) data.risks = toJson(p.risks);
    if (p.validation !== undefined) data.validation = p.validation === null ? Prisma.DbNull : toJson(p.validation);
    return proposalFromRow(await this.prisma.recoveryProposal.update({ where: { id }, data }));
  }
  async getProposal(id: string): Promise<ProposalRecord | null> {
    const row = await this.prisma.recoveryProposal.findUnique({ where: { id } });
    return row ? proposalFromRow(row) : null;
  }
  async listProposals(f: ProposalFilter): Promise<ProposalRecord[]> {
    return (await this.prisma.recoveryProposal.findMany({ where: { ...(f.monitorId ? { monitorId: f.monitorId } : {}), ...(f.incidentId ? { incidentId: f.incidentId } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: 'desc' }, take: f.limit })).map(proposalFromRow);
  }

  async appendAudit(i: NewAudit): Promise<AuditRecord> {
    const row = await this.prisma.auditEvent.create({ data: { actorType: i.actorType, actorId: i.actorId, action: i.action, entityType: i.entityType as Prisma.AuditEventCreateInput['entityType'], entityId: i.entityId, details: toJson(i.details) } });
    return auditFromRow(row);
  }
  async listAudit(limit: number, entityType?: string): Promise<AuditRecord[]> {
    const types = entityType ? [entityType] : [...AUDIT_TYPES];
    return (await this.prisma.auditEvent.findMany({ where: { entityType: { in: types as Prisma.AuditEventWhereInput['entityType'] extends infer T ? (T extends { in?: infer U } ? U : never) : never } }, orderBy: { createdAt: 'desc' }, take: limit })).map(auditFromRow);
  }

  async getSetting<T>(key: string): Promise<T | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return row ? (row.value as T) : null;
  }
  async setSetting(key: string, value: unknown, updatedBy: string): Promise<void> {
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: toJson(value), updatedBy }, update: { value: toJson(value), updatedBy } });
  }
}

type MonitorRow = Awaited<ReturnType<PrismaClient['monitor']['findUniqueOrThrow']>>;
type CheckRow = Awaited<ReturnType<PrismaClient['monitorCheck']['findUniqueOrThrow']>>;
type BaselineRow = Awaited<ReturnType<PrismaClient['monitorBaseline']['findUniqueOrThrow']>>;
type IncidentRow = Awaited<ReturnType<PrismaClient['monitorIncident']['findUniqueOrThrow']>>;
type MappingRow = Awaited<ReturnType<PrismaClient['featureMapping']['findUniqueOrThrow']>>;
type ProposalRow = Awaited<ReturnType<PrismaClient['recoveryProposal']['findUniqueOrThrow']>>;
type AuditRow = Awaited<ReturnType<PrismaClient['auditEvent']['findUniqueOrThrow']>>;

function monitorFromRow(r: MonitorRow): MonitorRecord {
  return { id: r.id, name: r.name, url: r.url, method: r.method, environment: r.environment, description: r.description, intervalSec: r.intervalSec, timeoutMs: r.timeoutMs, authType: r.authType, authHeader: r.authHeader, authSecretEnc: r.authSecretEnc, headers: (r.headers as Record<string, string> | null) ?? {}, body: r.body ?? null, expectedStatus: r.expectedStatus, autoBaseline: r.autoBaseline, status: r.status, createdBy: r.createdBy, nextRunAt: r.nextRunAt, lastCheckedAt: r.lastCheckedAt, lastOutcome: r.lastOutcome, lastStatusCode: r.lastStatusCode, lastLatencyMs: r.lastLatencyMs, activeProposalId: r.activeProposalId, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
function checkFromRow(r: CheckRow): CheckRecord {
  return { id: r.id, monitorId: r.monitorId, checkedAt: r.checkedAt, outcome: r.outcome, statusCode: r.statusCode, latencyMs: r.latencyMs, responseBytes: r.responseBytes, parseOutcome: r.parseOutcome, bodySample: r.bodySample ?? null, fieldPaths: (r.fieldPaths as FieldPath[] | null) ?? null, shapeHash: r.shapeHash, errorMessage: r.errorMessage, diff: (r.diff as ResponseDiff | null) ?? null, adapted: r.adapted, incidentId: r.incidentId, triggeredBy: r.triggeredBy };
}
function baselineFromRow(r: BaselineRow): BaselineRecord {
  return { id: r.id, monitorId: r.monitorId, version: r.version, status: r.status, checkId: r.checkId, statusCode: r.statusCode, latencyMs: r.latencyMs, snapshot: r.snapshot, fieldPaths: (r.fieldPaths as FieldPath[] | null) ?? [], shapeHash: r.shapeHash, approvedBy: r.approvedBy, approvedAt: r.approvedAt, note: r.note, createdAt: r.createdAt };
}
function incidentFromRow(r: IncidentRow): IncidentRecord {
  return { id: r.id, monitorId: r.monitorId, baselineId: r.baselineId, checkId: r.checkId, fingerprint: r.fingerprint, title: r.title, issueType: r.issueType, severity: r.severity, status: r.status, detectedAt: r.detectedAt, lastSeenAt: r.lastSeenAt, resolvedAt: r.resolvedAt, occurrenceCount: r.occurrenceCount, previousResponse: r.previousResponse ?? null, latestResponse: r.latestResponse ?? null, diffs: (r.diffs as FieldChange[] | null) ?? [], statusCode: r.statusCode, latencyMs: r.latencyMs, assignee: r.assignee, statusChangedBy: r.statusChangedBy, note: r.note, updatedAt: r.updatedAt };
}
function mappingFromRow(r: MappingRow): MappingRecord {
  return { id: r.id, monitorId: r.monitorId, feature: r.feature, jsonPath: r.jsonPath, route: r.route, impactLevel: r.impactLevel, description: r.description, symptom: r.symptom, createdBy: r.createdBy, createdAt: r.createdAt };
}
function proposalFromRow(r: ProposalRow): ProposalRecord {
  return { id: r.id, incidentId: r.incidentId, monitorId: r.monitorId, status: r.status, proposedSolution: r.proposedSolution, transform: r.transform as AdapterSpec, assumptions: (r.assumptions as string[] | null) ?? [], risks: (r.risks as string[] | null) ?? [], requiresManualReview: r.requiresManualReview, targetEnvironment: r.targetEnvironment, createdBy: r.createdBy, approver: r.approver, approvedAt: r.approvedAt, rejectedBy: r.rejectedBy, rejectedAt: r.rejectedAt, promotedBy: r.promotedBy, promotedAt: r.promotedAt, validation: (r.validation as ValidationResult | null) ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
function auditFromRow(r: AuditRow): AuditRecord {
  return { id: r.id, actorType: r.actorType, actorId: r.actorId, action: r.action, entityType: r.entityType, entityId: r.entityId, details: (r.details as Record<string, unknown> | null) ?? {}, createdAt: r.createdAt };
}

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

export class InMemoryGuardianStore implements GuardianStore {
  monitors = new Map<string, MonitorRecord>();
  checks: CheckRecord[] = [];
  baselines: BaselineRecord[] = [];
  incidents = new Map<string, IncidentRecord>();
  mappings = new Map<string, MappingRecord>();
  proposals = new Map<string, ProposalRecord>();
  audit: AuditRecord[] = [];
  settings = new Map<string, unknown>();

  private clone<T>(v: T): T {
    return structuredClone(v);
  }
  createMonitor(i: NewMonitor): Promise<MonitorRecord> {
    const now = new Date();
    const rec: MonitorRecord = { ...i, id: randomUUID(), lastCheckedAt: null, lastOutcome: null, lastStatusCode: null, lastLatencyMs: null, activeProposalId: null, createdAt: now, updatedAt: now };
    this.monitors.set(rec.id, rec);
    return Promise.resolve(this.clone(rec));
  }
  updateMonitor(id: string, p: MonitorPatch): Promise<MonitorRecord> {
    const cur = this.monitors.get(id);
    if (!cur) return Promise.reject(new Error('monitor not found'));
    const next = { ...cur, ...stripUndefined(p), updatedAt: new Date() };
    this.monitors.set(id, next);
    return Promise.resolve(this.clone(next));
  }
  deleteMonitor(id: string): Promise<void> {
    this.monitors.delete(id);
    this.checks = this.checks.filter((c) => c.monitorId !== id);
    this.baselines = this.baselines.filter((b) => b.monitorId !== id);
    for (const [k, v] of this.incidents) if (v.monitorId === id) this.incidents.delete(k);
    for (const [k, v] of this.mappings) if (v.monitorId === id) this.mappings.delete(k);
    for (const [k, v] of this.proposals) if (v.monitorId === id) this.proposals.delete(k);
    return Promise.resolve();
  }
  getMonitor(id: string): Promise<MonitorRecord | null> {
    const m = this.monitors.get(id);
    return Promise.resolve(m ? this.clone(m) : null);
  }
  listMonitors(): Promise<MonitorRecord[]> {
    return Promise.resolve([...this.monitors.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((m) => this.clone(m)));
  }
  listDueMonitors(now: Date, limit: number): Promise<MonitorRecord[]> {
    return Promise.resolve([...this.monitors.values()].filter((m) => m.status === 'ACTIVE' && (!m.nextRunAt || m.nextRunAt <= now)).slice(0, limit).map((m) => this.clone(m)));
  }
  createCheck(i: NewCheck): Promise<CheckRecord> {
    const rec = { ...i, id: randomUUID() };
    this.checks.push(rec);
    return Promise.resolve(this.clone(rec));
  }
  updateCheck(id: string, p: Partial<Pick<CheckRecord, 'diff' | 'incidentId' | 'adapted'>>): Promise<CheckRecord> {
    const idx = this.checks.findIndex((c) => c.id === id);
    if (idx < 0) return Promise.reject(new Error('check not found'));
    this.checks[idx] = { ...this.checks[idx]!, ...stripUndefined(p) };
    return Promise.resolve(this.clone(this.checks[idx]));
  }
  getCheck(id: string): Promise<CheckRecord | null> {
    const c = this.checks.find((x) => x.id === id);
    return Promise.resolve(c ? this.clone(c) : null);
  }
  listChecks(monitorId: string, limit: number): Promise<CheckRecord[]> {
    return Promise.resolve(this.checks.filter((c) => c.monitorId === monitorId).sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()).slice(0, limit).map((c) => this.clone(c)));
  }
  async latestCheck(monitorId: string): Promise<CheckRecord | null> {
    return (await this.listChecks(monitorId, 1))[0] ?? null;
  }
  listChecksSince(since: Date, limit: number): Promise<CheckRecord[]> {
    return Promise.resolve(this.checks.filter((c) => c.checkedAt >= since).sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()).slice(0, limit).map((c) => this.clone(c)));
  }
  createBaseline(i: NewBaseline): Promise<BaselineRecord> {
    const version = Math.max(0, ...this.baselines.filter((b) => b.monitorId === i.monitorId).map((b) => b.version)) + 1;
    if (i.status === 'APPROVED') for (const b of this.baselines) if (b.monitorId === i.monitorId && b.status === 'APPROVED') b.status = 'SUPERSEDED';
    const rec: BaselineRecord = { ...i, id: randomUUID(), version, createdAt: new Date() };
    this.baselines.push(rec);
    return Promise.resolve(this.clone(rec));
  }
  updateBaseline(id: string, p: Partial<Pick<BaselineRecord, 'status' | 'approvedBy' | 'approvedAt' | 'note'>>): Promise<BaselineRecord> {
    const b = this.baselines.find((x) => x.id === id);
    if (!b) return Promise.reject(new Error('baseline not found'));
    if (p.status === 'APPROVED') for (const o of this.baselines) if (o.monitorId === b.monitorId && o.status === 'APPROVED' && o.id !== id) o.status = 'SUPERSEDED';
    Object.assign(b, stripUndefined(p));
    return Promise.resolve(this.clone(b));
  }
  getBaseline(id: string): Promise<BaselineRecord | null> {
    const b = this.baselines.find((x) => x.id === id);
    return Promise.resolve(b ? this.clone(b) : null);
  }
  listBaselines(monitorId: string): Promise<BaselineRecord[]> {
    return Promise.resolve(this.baselines.filter((b) => b.monitorId === monitorId).sort((a, b) => b.version - a.version).map((b) => this.clone(b)));
  }
  approvedBaseline(monitorId: string): Promise<BaselineRecord | null> {
    const b = this.baselines.filter((x) => x.monitorId === monitorId && x.status === 'APPROVED').sort((a, c) => c.version - a.version)[0];
    return Promise.resolve(b ? this.clone(b) : null);
  }
  createIncident(i: NewIncident): Promise<IncidentRecord> {
    const now = new Date();
    const rec: IncidentRecord = { ...i, id: randomUUID(), detectedAt: now, lastSeenAt: now, resolvedAt: null, occurrenceCount: 1, updatedAt: now };
    this.incidents.set(rec.id, rec);
    return Promise.resolve(this.clone(rec));
  }
  updateIncident(id: string, p: IncidentPatch): Promise<IncidentRecord> {
    const cur = this.incidents.get(id);
    if (!cur) return Promise.reject(new Error('incident not found'));
    const next = { ...cur, ...stripUndefined(p), updatedAt: new Date() };
    this.incidents.set(id, next);
    return Promise.resolve(this.clone(next));
  }
  getIncident(id: string): Promise<IncidentRecord | null> {
    const i = this.incidents.get(id);
    return Promise.resolve(i ? this.clone(i) : null);
  }
  listIncidents(f: IncidentFilter): Promise<IncidentRecord[]> {
    return Promise.resolve(
      [...this.incidents.values()]
        .filter((i) => (!f.monitorId || i.monitorId === f.monitorId) && (!f.status || i.status === f.status) && (!f.severity || i.severity === f.severity))
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
        .slice(0, f.limit)
        .map((i) => this.clone(i)),
    );
  }
  findOpenIncident(monitorId: string, fingerprint: string): Promise<IncidentRecord | null> {
    const i = [...this.incidents.values()].filter((x) => x.monitorId === monitorId && x.fingerprint === fingerprint && x.status !== 'RESOLVED').sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())[0];
    return Promise.resolve(i ? this.clone(i) : null);
  }
  findRecentlyResolvedIncident(monitorId: string, fingerprint: string, since: Date): Promise<IncidentRecord | null> {
    const i = [...this.incidents.values()].filter((x) => x.monitorId === monitorId && x.fingerprint === fingerprint && x.status === 'RESOLVED' && x.resolvedAt !== null && x.resolvedAt >= since).sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0))[0];
    return Promise.resolve(i ? this.clone(i) : null);
  }
  createMapping(i: NewMapping): Promise<MappingRecord> {
    const rec = { ...i, id: randomUUID(), createdAt: new Date() };
    this.mappings.set(rec.id, rec);
    return Promise.resolve(this.clone(rec));
  }
  deleteMapping(id: string): Promise<void> {
    this.mappings.delete(id);
    return Promise.resolve();
  }
  getMapping(id: string): Promise<MappingRecord | null> {
    const m = this.mappings.get(id);
    return Promise.resolve(m ? this.clone(m) : null);
  }
  listMappings(monitorId?: string): Promise<MappingRecord[]> {
    return Promise.resolve([...this.mappings.values()].filter((m) => !monitorId || m.monitorId === monitorId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((m) => this.clone(m)));
  }
  createProposal(i: NewProposal): Promise<ProposalRecord> {
    const now = new Date();
    const rec: ProposalRecord = { ...i, id: randomUUID(), approver: null, approvedAt: null, rejectedBy: null, rejectedAt: null, promotedBy: null, promotedAt: null, validation: null, createdAt: now, updatedAt: now };
    this.proposals.set(rec.id, rec);
    return Promise.resolve(this.clone(rec));
  }
  updateProposal(id: string, p: ProposalPatch): Promise<ProposalRecord> {
    const cur = this.proposals.get(id);
    if (!cur) return Promise.reject(new Error('proposal not found'));
    const next = { ...cur, ...stripUndefined(p), updatedAt: new Date() };
    this.proposals.set(id, next);
    return Promise.resolve(this.clone(next));
  }
  getProposal(id: string): Promise<ProposalRecord | null> {
    const p = this.proposals.get(id);
    return Promise.resolve(p ? this.clone(p) : null);
  }
  listProposals(f: ProposalFilter): Promise<ProposalRecord[]> {
    return Promise.resolve(
      [...this.proposals.values()]
        .filter((p) => (!f.monitorId || p.monitorId === f.monitorId) && (!f.incidentId || p.incidentId === f.incidentId) && (!f.status || p.status === f.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, f.limit)
        .map((p) => this.clone(p)),
    );
  }
  appendAudit(i: NewAudit): Promise<AuditRecord> {
    const rec = { ...i, id: randomUUID(), createdAt: new Date() };
    this.audit.push(rec);
    return Promise.resolve(this.clone(rec));
  }
  listAudit(limit: number, entityType?: string): Promise<AuditRecord[]> {
    return Promise.resolve([...this.audit].filter((a) => !entityType || a.entityType === entityType).reverse().slice(0, limit).map((a) => this.clone(a)));
  }
  getSetting<T>(key: string): Promise<T | null> {
    return Promise.resolve(this.settings.has(key) ? (this.clone(this.settings.get(key)) as T) : null);
  }
  setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, this.clone(value));
    return Promise.resolve();
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
