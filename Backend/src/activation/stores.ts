import { randomUUID } from 'node:crypto';
import type { ActivationEvent, ActivationKind, AdapterActivation, ApprovalDecision, Initiator, Prisma, RepairApproval, RepairValidationRun, ValidationRunStatus, VerificationRun } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { ValidationReport } from './pipeline.js';

/**
 * Persistence for the activation lifecycle: validation runs, approvals, the
 * active-version pointer, the append-only event history and verification
 * runs. Pointer changes go through `withLock` + a revision check so two
 * writers can never interleave.
 */

export interface ValidationRunRecord {
  id: string;
  proposalId: string;
  repairVersionId: string;
  checksum: string;
  status: ValidationRunStatus;
  report: ValidationReport;
  reportHash: string;
  totalTests: number;
  mandatoryFailures: number;
  triggeredBy: string;
  durationMs: number;
  createdAt: Date;
}
export interface ApprovalRecord {
  id: string;
  proposalId: string;
  repairVersionId: string;
  validationRunId: string | null;
  actor: string;
  decision: ApprovalDecision;
  note: string | null;
  createdAt: Date;
}
export interface SafetyConfig {
  minProbes: number;
  maxErrorRate: number;
  maxContractViolationRate: number;
  autoRollback: boolean;
}
export const DEFAULT_SAFETY: SafetyConfig = { minProbes: 3, maxErrorRate: 0.34, maxContractViolationRate: 0, autoRollback: true };

export interface PointerRecord {
  adapterKey: string;
  endpointKey: string;
  activeVersionId: string | null;
  previousVersionId: string | null;
  lastGoodVersionId: string | null;
  revision: number;
  safety: SafetyConfig;
  updatedBy: string;
  updatedAt: Date;
}
export interface PointerPatch {
  activeVersionId: string | null;
  previousVersionId: string | null;
  lastGoodVersionId?: string | null;
  safety?: SafetyConfig;
  updatedBy: string;
}
export interface EventRecord {
  id: string;
  adapterKey: string;
  endpointKey: string;
  kind: ActivationKind;
  fromVersionId: string | null;
  toVersionId: string | null;
  proposalId: string | null;
  revision: number;
  actor: string;
  initiator: Initiator;
  evidence: Record<string, unknown>;
  reason: string | null;
  createdAt: Date;
}
export interface VerificationRecord {
  id: string;
  activationEventId: string;
  adapterKey: string;
  endpointKey: string;
  versionId: string;
  probes: number;
  probeErrors: number;
  contractViolations: number;
  passed: boolean;
  thresholds: SafetyConfig;
  details: Record<string, unknown>;
  action: 'NONE' | 'AUTO_ROLLBACK';
  triggeredBy: string;
  createdAt: Date;
}
export interface TestRunInput {
  repairVersionId: string;
  workflowNodeId: string | null;
  validationRunId: string;
  testKey: string;
  mandatory: boolean;
  status: 'PASSED' | 'FAILED' | 'ERROR';
  triggeredBy: string;
  durationMs: number;
  results: unknown[];
  summary: string;
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`activation pointer changed concurrently (expected revision ${expected}, found ${actual})`);
    this.name = 'RevisionConflictError';
  }
}

export interface ActivationStore {
  saveValidationRun(input: Omit<ValidationRunRecord, 'id' | 'createdAt'>, testRuns: TestRunInput[]): Promise<ValidationRunRecord>;
  latestValidationRun(proposalId: string): Promise<ValidationRunRecord | null>;
  listValidationRuns(proposalId: string, limit: number): Promise<ValidationRunRecord[]>;
  addApproval(input: Omit<ApprovalRecord, 'id' | 'createdAt'>): Promise<ApprovalRecord>;
  listApprovals(proposalId: string): Promise<ApprovalRecord[]>;
  getPointer(adapterKey: string, endpointKey: string): Promise<PointerRecord>;
  listPointers(): Promise<PointerRecord[]>;
  /** Compare-and-set: applies the patch only if the stored revision equals `expectedRevision`; returns the new revision. */
  updatePointer(adapterKey: string, endpointKey: string, expectedRevision: number, patch: PointerPatch): Promise<PointerRecord>;
  appendEvent(input: Omit<EventRecord, 'id' | 'createdAt'>): Promise<EventRecord>;
  listEvents(adapterKey: string, endpointKey: string, limit: number): Promise<EventRecord[]>;
  latestEvent(adapterKey: string, endpointKey: string): Promise<EventRecord | null>;
  saveVerification(input: Omit<VerificationRecord, 'id' | 'createdAt'>): Promise<VerificationRecord>;
  listVerifications(adapterKey: string, endpointKey: string, limit: number): Promise<VerificationRecord[]>;
  /** Serialises pointer mutations per adapter endpoint within this process (and, for Prisma, across processes). */
  withLock<T>(adapterKey: string, endpointKey: string, fn: () => Promise<T>): Promise<T>;
}

/** Per-key promise chain: callers queue behind each other. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tail = prev.then(() => gate);
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
const safetyOf = (v: unknown): SafetyConfig => ({ ...DEFAULT_SAFETY, ...((v as Partial<SafetyConfig> | null) ?? {}) });
const vrFrom = (r: RepairValidationRun): ValidationRunRecord => ({ id: r.id, proposalId: r.proposalId, repairVersionId: r.repairVersionId, checksum: r.checksum, status: r.status, report: r.report as unknown as ValidationReport, reportHash: r.reportHash, totalTests: r.totalTests, mandatoryFailures: r.mandatoryFailures, triggeredBy: r.triggeredBy, durationMs: r.durationMs, createdAt: r.createdAt });
const apFrom = (r: RepairApproval): ApprovalRecord => ({ id: r.id, proposalId: r.proposalId, repairVersionId: r.repairVersionId, validationRunId: r.validationRunId, actor: r.actor, decision: r.decision, note: r.note, createdAt: r.createdAt });
const ptrFrom = (r: AdapterActivation): PointerRecord => ({ adapterKey: r.adapterKey, endpointKey: r.endpointKey, activeVersionId: r.activeVersionId, previousVersionId: r.previousVersionId, lastGoodVersionId: r.lastGoodVersionId, revision: r.revision, safety: safetyOf(r.safety), updatedBy: r.updatedBy, updatedAt: r.updatedAt });
const evFrom = (r: ActivationEvent): EventRecord => ({ id: r.id, adapterKey: r.adapterKey, endpointKey: r.endpointKey, kind: r.kind, fromVersionId: r.fromVersionId, toVersionId: r.toVersionId, proposalId: r.proposalId, revision: r.revision, actor: r.actor, initiator: r.initiator, evidence: (r.evidence as Record<string, unknown> | null) ?? {}, reason: r.reason, createdAt: r.createdAt });
const vfFrom = (r: VerificationRun): VerificationRecord => ({ id: r.id, activationEventId: r.activationEventId, adapterKey: r.adapterKey, endpointKey: r.endpointKey, versionId: r.versionId, probes: r.probes, probeErrors: r.probeErrors, contractViolations: r.contractViolations, passed: r.passed, thresholds: safetyOf(r.thresholds), details: (r.details as Record<string, unknown> | null) ?? {}, action: r.action as 'NONE' | 'AUTO_ROLLBACK', triggeredBy: r.triggeredBy, createdAt: r.createdAt });

export class PrismaActivationStore implements ActivationStore {
  private readonly mutex = new KeyedMutex();
  constructor(private readonly prisma: PrismaClient) {}

  async saveValidationRun(input: Omit<ValidationRunRecord, 'id' | 'createdAt'>, testRuns: TestRunInput[]): Promise<ValidationRunRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.repairValidationRun.create({ data: { ...input, stages: toJson(input.report.stages), report: toJson(input.report) } });
      for (const t of testRuns) {
        if (!t.workflowNodeId) continue; // TestRun requires a node; synthetic suites live in the report only
        await tx.testRun.create({ data: { repairVersionId: t.repairVersionId, workflowId: t.workflowNodeId, validationRunId: row.id, testKey: t.testKey, mandatory: t.mandatory, status: t.status, triggeredBy: t.triggeredBy, startedAt: new Date(), finishedAt: new Date(), durationMs: t.durationMs, results: toJson(t.results), summary: t.summary } });
      }
      await tx.auditEvent.create({ data: { actorType: input.triggeredBy === 'system' ? 'SYSTEM' : 'USER', actorId: input.triggeredBy, action: `validation.${input.status.toLowerCase()}`, entityType: 'VALIDATION_RUN', entityId: row.id, details: toJson({ proposalId: input.proposalId, checksum: input.checksum, mandatoryFailures: input.mandatoryFailures }) } });
      return vrFrom(row);
    });
  }
  async latestValidationRun(proposalId: string): Promise<ValidationRunRecord | null> {
    const r = await this.prisma.repairValidationRun.findFirst({ where: { proposalId }, orderBy: { createdAt: 'desc' } });
    return r ? vrFrom(r) : null;
  }
  async listValidationRuns(proposalId: string, limit: number): Promise<ValidationRunRecord[]> {
    return (await this.prisma.repairValidationRun.findMany({ where: { proposalId }, orderBy: { createdAt: 'desc' }, take: limit })).map(vrFrom);
  }
  async addApproval(input: Omit<ApprovalRecord, 'id' | 'createdAt'>): Promise<ApprovalRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.repairApproval.create({ data: input });
      await tx.auditEvent.create({ data: { actorType: 'USER', actorId: input.actor, action: input.decision === 'APPROVE' ? 'repair.approved' : 'repair.rejected', entityType: 'REPAIR_PROPOSAL', entityId: input.proposalId, details: toJson({ versionId: input.repairVersionId, validationRunId: input.validationRunId, note: input.note }) } });
      return apFrom(row);
    });
  }
  async listApprovals(proposalId: string): Promise<ApprovalRecord[]> {
    return (await this.prisma.repairApproval.findMany({ where: { proposalId }, orderBy: { createdAt: 'asc' } })).map(apFrom);
  }
  async getPointer(adapterKey: string, endpointKey: string): Promise<PointerRecord> {
    const row = await this.prisma.adapterActivation.upsert({ where: { adapterKey_endpointKey: { adapterKey, endpointKey } }, create: { adapterKey, endpointKey, safety: toJson(DEFAULT_SAFETY) }, update: {} });
    return ptrFrom(row);
  }
  async listPointers(): Promise<PointerRecord[]> {
    return (await this.prisma.adapterActivation.findMany({ orderBy: [{ adapterKey: 'asc' }, { endpointKey: 'asc' }] })).map(ptrFrom);
  }
  async updatePointer(adapterKey: string, endpointKey: string, expectedRevision: number, patch: PointerPatch): Promise<PointerRecord> {
    return this.prisma.$transaction(async (tx) => {
      // Cross-process serialisation: an advisory lock scoped to the transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${adapterKey}|${endpointKey}`}))`;
      const current = await tx.adapterActivation.upsert({ where: { adapterKey_endpointKey: { adapterKey, endpointKey } }, create: { adapterKey, endpointKey, safety: toJson(DEFAULT_SAFETY) }, update: {} });
      if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision);
      const { safety, ...rest } = patch;
      const row = await tx.adapterActivation.update({ where: { id: current.id }, data: { ...rest, ...(safety ? { safety: toJson(safety) } : {}), revision: { increment: 1 } } });
      return ptrFrom(row);
    });
  }
  async appendEvent(input: Omit<EventRecord, 'id' | 'createdAt'>): Promise<EventRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.activationEvent.create({ data: { ...input, evidence: toJson(input.evidence) } });
      await tx.auditEvent.create({ data: { actorType: input.initiator === 'SYSTEM' ? 'SYSTEM' : 'USER', actorId: input.actor, action: `activation.${input.kind.toLowerCase()}`, entityType: 'ACTIVATION', entityId: row.id, details: toJson({ adapterKey: input.adapterKey, endpointKey: input.endpointKey, from: input.fromVersionId, to: input.toVersionId, reason: input.reason }) } });
      return evFrom(row);
    });
  }
  async listEvents(adapterKey: string, endpointKey: string, limit: number): Promise<EventRecord[]> {
    return (await this.prisma.activationEvent.findMany({ where: { adapterKey, endpointKey }, orderBy: { createdAt: 'desc' }, take: limit })).map(evFrom);
  }
  async latestEvent(adapterKey: string, endpointKey: string): Promise<EventRecord | null> {
    const r = await this.prisma.activationEvent.findFirst({ where: { adapterKey, endpointKey }, orderBy: { createdAt: 'desc' } });
    return r ? evFrom(r) : null;
  }
  async saveVerification(input: Omit<VerificationRecord, 'id' | 'createdAt'>): Promise<VerificationRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.verificationRun.create({ data: { ...input, thresholds: toJson(input.thresholds), details: toJson(input.details) } });
      await tx.auditEvent.create({ data: { actorType: input.triggeredBy === 'system' ? 'SYSTEM' : 'USER', actorId: input.triggeredBy, action: input.passed ? 'verification.passed' : 'verification.failed', entityType: 'VERIFICATION_RUN', entityId: row.id, details: toJson({ adapterKey: input.adapterKey, endpointKey: input.endpointKey, probes: input.probes, probeErrors: input.probeErrors, contractViolations: input.contractViolations, action: input.action }) } });
      return vfFrom(row);
    });
  }
  async listVerifications(adapterKey: string, endpointKey: string, limit: number): Promise<VerificationRecord[]> {
    return (await this.prisma.verificationRun.findMany({ where: { adapterKey, endpointKey }, orderBy: { createdAt: 'desc' }, take: limit })).map(vfFrom);
  }
  withLock<T>(adapterKey: string, endpointKey: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(`${adapterKey}|${endpointKey}`, fn);
  }
}

// ---------------------------------------------------------------------------
// In-memory (tests)
// ---------------------------------------------------------------------------

export class InMemoryActivationStore implements ActivationStore {
  readonly validationRuns: ValidationRunRecord[] = [];
  readonly approvals: ApprovalRecord[] = [];
  readonly pointers = new Map<string, PointerRecord>();
  readonly events: EventRecord[] = [];
  readonly verifications: VerificationRecord[] = [];
  readonly testRuns: Array<TestRunInput & { id: string }> = [];
  readonly audit: string[] = [];
  private readonly mutex = new KeyedMutex();

  saveValidationRun(input: Omit<ValidationRunRecord, 'id' | 'createdAt'>, testRuns: TestRunInput[]): Promise<ValidationRunRecord> {
    const row: ValidationRunRecord = { ...structuredClone(input), id: randomUUID(), createdAt: new Date() };
    this.validationRuns.push(row);
    for (const t of testRuns) this.testRuns.push({ ...t, id: randomUUID(), validationRunId: row.id });
    this.audit.push(`validation.${input.status.toLowerCase()}`);
    return Promise.resolve(structuredClone(row));
  }
  latestValidationRun(proposalId: string): Promise<ValidationRunRecord | null> {
    const r = [...this.validationRuns].reverse().find((x) => x.proposalId === proposalId);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
  listValidationRuns(proposalId: string, limit: number): Promise<ValidationRunRecord[]> {
    return Promise.resolve(this.validationRuns.filter((x) => x.proposalId === proposalId).reverse().slice(0, limit).map((r) => structuredClone(r)));
  }
  addApproval(input: Omit<ApprovalRecord, 'id' | 'createdAt'>): Promise<ApprovalRecord> {
    const row: ApprovalRecord = { ...input, id: randomUUID(), createdAt: new Date() };
    this.approvals.push(row);
    this.audit.push(input.decision === 'APPROVE' ? 'repair.approved' : 'repair.rejected');
    return Promise.resolve(structuredClone(row));
  }
  listApprovals(proposalId: string): Promise<ApprovalRecord[]> {
    return Promise.resolve(this.approvals.filter((a) => a.proposalId === proposalId).map((a) => structuredClone(a)));
  }
  private key(a: string, e: string): string {
    return `${a}|${e}`;
  }
  getPointer(adapterKey: string, endpointKey: string): Promise<PointerRecord> {
    const k = this.key(adapterKey, endpointKey);
    let p = this.pointers.get(k);
    if (!p) {
      p = { adapterKey, endpointKey, activeVersionId: null, previousVersionId: null, lastGoodVersionId: null, revision: 0, safety: { ...DEFAULT_SAFETY }, updatedBy: 'system', updatedAt: new Date() };
      this.pointers.set(k, p);
    }
    return Promise.resolve(structuredClone(p));
  }
  listPointers(): Promise<PointerRecord[]> {
    return Promise.resolve([...this.pointers.values()].map((p) => structuredClone(p)));
  }
  async updatePointer(adapterKey: string, endpointKey: string, expectedRevision: number, patch: PointerPatch): Promise<PointerRecord> {
    await this.getPointer(adapterKey, endpointKey);
    const p = this.pointers.get(this.key(adapterKey, endpointKey)) as PointerRecord;
    if (p.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, p.revision);
    const { safety, ...rest } = patch;
    Object.assign(p, rest, safety ? { safety } : {}, { revision: p.revision + 1, updatedAt: new Date() });
    return structuredClone(p);
  }
  appendEvent(input: Omit<EventRecord, 'id' | 'createdAt'>): Promise<EventRecord> {
    const row: EventRecord = { ...structuredClone(input), id: randomUUID(), createdAt: new Date() };
    this.events.push(row);
    this.audit.push(`activation.${input.kind.toLowerCase()}`);
    return Promise.resolve(structuredClone(row));
  }
  listEvents(adapterKey: string, endpointKey: string, limit: number): Promise<EventRecord[]> {
    return Promise.resolve(this.events.filter((e) => e.adapterKey === adapterKey && e.endpointKey === endpointKey).reverse().slice(0, limit).map((e) => structuredClone(e)));
  }
  latestEvent(adapterKey: string, endpointKey: string): Promise<EventRecord | null> {
    const e = [...this.events].reverse().find((x) => x.adapterKey === adapterKey && x.endpointKey === endpointKey);
    return Promise.resolve(e ? structuredClone(e) : null);
  }
  saveVerification(input: Omit<VerificationRecord, 'id' | 'createdAt'>): Promise<VerificationRecord> {
    const row: VerificationRecord = { ...structuredClone(input), id: randomUUID(), createdAt: new Date() };
    this.verifications.push(row);
    this.audit.push(input.passed ? 'verification.passed' : 'verification.failed');
    return Promise.resolve(structuredClone(row));
  }
  listVerifications(adapterKey: string, endpointKey: string, limit: number): Promise<VerificationRecord[]> {
    return Promise.resolve(this.verifications.filter((v) => v.adapterKey === adapterKey && v.endpointKey === endpointKey).reverse().slice(0, limit).map((v) => structuredClone(v)));
  }
  withLock<T>(adapterKey: string, endpointKey: string, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(this.key(adapterKey, endpointKey), fn);
  }
}
