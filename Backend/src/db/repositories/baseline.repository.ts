import type { Baseline, BaselineStatus } from '../../generated/prisma/client.js';
import type { DbClient, JsonInput } from '../types.js';

export interface CreateBaselineInput {
  nodeId: string;
  summary: JsonInput;
  sampleCount?: number;
  builtFrom?: string;
  status?: BaselineStatus;
}

export class BaselineRepository {
  constructor(private readonly db: DbClient) {}

  /** Creates the next version for the node (versions are 1-based and gap-free). */
  async createNextVersion(input: CreateBaselineInput): Promise<Baseline> {
    const latest = await this.db.baseline.findFirst({
      where: { nodeId: input.nodeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return this.db.baseline.create({
      data: { ...input, version: (latest?.version ?? 0) + 1 },
    });
  }

  findById(id: string): Promise<Baseline | null> {
    return this.db.baseline.findUnique({ where: { id } });
  }

  findActive(nodeId: string): Promise<Baseline | null> {
    return this.db.baseline.findFirst({ where: { nodeId, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
  }

  listForNode(nodeId: string): Promise<Baseline[]> {
    return this.db.baseline.findMany({ where: { nodeId }, orderBy: { version: 'desc' } });
  }

  /**
   * Activate a baseline and supersede any other ACTIVE baseline for the same
   * node. The schema cannot express "at most one ACTIVE per node", so this is
   * enforced here; callers should run it inside a transaction.
   */
  async activate(id: string, now: Date = new Date()): Promise<Baseline> {
    const target = await this.db.baseline.findUniqueOrThrow({ where: { id } });
    await this.db.baseline.updateMany({
      where: { nodeId: target.nodeId, status: 'ACTIVE', id: { not: id } },
      data: { status: 'SUPERSEDED', supersededAt: now },
    });
    return this.db.baseline.update({
      where: { id },
      data: { status: 'ACTIVE', activatedAt: now, supersededAt: null },
    });
  }
}
