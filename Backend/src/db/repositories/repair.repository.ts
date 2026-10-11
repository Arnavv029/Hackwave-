import { createHash } from 'node:crypto';
import type {
  ProposalStatus,
  RepairKind,
  RepairProposal,
  RepairVersion,
  RepairVersionStatus,
  RiskLevel,
} from '../../generated/prisma/client.js';
import type { DbClient, JsonInput } from '../types.js';

export interface CreateRepairProposalInput {
  findingId: string;
  kind: RepairKind;
  rationale: string;
  risk?: RiskLevel;
  preconditions?: JsonInput;
  requiresHumanReview?: boolean;
  createdBy?: string;
}

export interface CreateRepairVersionInput {
  proposalId: string;
  spec: JsonInput;
}

export interface ReviewDecision {
  reviewedBy: string;
  status: Extract<ProposalStatus, 'VALIDATING' | 'REJECTED' | 'BLOCKED'>;
  blockedReason?: string;
}

/** Stable SHA-256 over canonical JSON so equal specs get equal checksums. */
export function checksumSpec(spec: JsonInput): string {
  return createHash('sha256').update(canonicalJson(spec)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class RepairProposalRepository {
  constructor(private readonly db: DbClient) {}

  create(input: CreateRepairProposalInput): Promise<RepairProposal> {
    return this.db.repairProposal.create({ data: input });
  }

  findById(id: string): Promise<RepairProposal | null> {
    return this.db.repairProposal.findUnique({ where: { id } });
  }

  listForFinding(findingId: string): Promise<RepairProposal[]> {
    return this.db.repairProposal.findMany({ where: { findingId }, orderBy: { createdAt: 'desc' } });
  }

  setStatus(id: string, status: ProposalStatus, blockedReason?: string): Promise<RepairProposal> {
    return this.db.repairProposal.update({
      where: { id },
      data: { status, blockedReason: blockedReason ?? null },
    });
  }

  review(id: string, decision: ReviewDecision, now: Date = new Date()): Promise<RepairProposal> {
    return this.db.repairProposal.update({
      where: { id },
      data: {
        status: decision.status,
        reviewedBy: decision.reviewedBy,
        reviewedAt: now,
        blockedReason: decision.blockedReason ?? null,
      },
    });
  }
}

export class RepairVersionRepository {
  constructor(private readonly db: DbClient) {}

  /** Append the next immutable version of a proposal's adapter spec. */
  async createNextVersion(input: CreateRepairVersionInput): Promise<RepairVersion> {
    const latest = await this.db.repairVersion.findFirst({
      where: { proposalId: input.proposalId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return this.db.repairVersion.create({
      data: {
        proposalId: input.proposalId,
        spec: input.spec,
        checksum: checksumSpec(input.spec),
        version: (latest?.version ?? 0) + 1,
      },
    });
  }

  findById(id: string): Promise<RepairVersion | null> {
    return this.db.repairVersion.findUnique({ where: { id } });
  }

  listForProposal(proposalId: string): Promise<RepairVersion[]> {
    return this.db.repairVersion.findMany({ where: { proposalId }, orderBy: { version: 'desc' } });
  }

  findActive(proposalId: string): Promise<RepairVersion | null> {
    return this.db.repairVersion.findFirst({ where: { proposalId, status: 'ACTIVE' } });
  }

  setStatus(id: string, status: RepairVersionStatus): Promise<RepairVersion> {
    return this.db.repairVersion.update({ where: { id }, data: { status } });
  }

  /**
   * Mark a version ACTIVE and supersede any previously active version of the
   * same proposal. Run inside a transaction with the proposal status change.
   */
  async activate(id: string, now: Date = new Date()): Promise<RepairVersion> {
    const target = await this.db.repairVersion.findUniqueOrThrow({ where: { id } });
    await this.db.repairVersion.updateMany({
      where: { proposalId: target.proposalId, status: 'ACTIVE', id: { not: id } },
      data: { status: 'SUPERSEDED', deactivatedAt: now },
    });
    return this.db.repairVersion.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: now, deactivatedAt: null },
    });
  }
}
