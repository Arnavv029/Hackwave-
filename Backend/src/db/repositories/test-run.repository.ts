import type { TestRun, TestRunStatus } from '../../generated/prisma/client.js';
import type { DbClient, JsonInput } from '../types.js';

export interface CreateTestRunInput {
  repairVersionId: string;
  workflowId: string;
  triggeredBy?: string;
}

export interface FinishTestRunInput {
  status: Extract<TestRunStatus, 'PASSED' | 'FAILED' | 'ERROR'>;
  results: JsonInput;
  summary?: string;
  finishedAt?: Date;
}

export class TestRunRepository {
  constructor(private readonly db: DbClient) {}

  create(input: CreateTestRunInput): Promise<TestRun> {
    return this.db.testRun.create({ data: input });
  }

  findById(id: string): Promise<TestRun | null> {
    return this.db.testRun.findUnique({ where: { id } });
  }

  listForRepairVersion(repairVersionId: string): Promise<TestRun[]> {
    return this.db.testRun.findMany({ where: { repairVersionId }, orderBy: { createdAt: 'desc' } });
  }

  start(id: string, now: Date = new Date()): Promise<TestRun> {
    return this.db.testRun.update({ where: { id }, data: { status: 'RUNNING', startedAt: now } });
  }

  async finish(id: string, input: FinishTestRunInput): Promise<TestRun> {
    const finishedAt = input.finishedAt ?? new Date();
    const current = await this.db.testRun.findUniqueOrThrow({ where: { id }, select: { startedAt: true } });
    const durationMs = current.startedAt ? Math.max(0, finishedAt.getTime() - current.startedAt.getTime()) : null;
    return this.db.testRun.update({
      where: { id },
      data: {
        status: input.status,
        results: input.results,
        summary: input.summary ?? null,
        finishedAt,
        durationMs,
      },
    });
  }

  /** True when every run for the version passed and at least one run exists. */
  async allPassed(repairVersionId: string): Promise<boolean> {
    const [total, passed] = await Promise.all([
      this.db.testRun.count({ where: { repairVersionId } }),
      this.db.testRun.count({ where: { repairVersionId, status: 'PASSED' } }),
    ]);
    return total > 0 && total === passed;
  }
}
