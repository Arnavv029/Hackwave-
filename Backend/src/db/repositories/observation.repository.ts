import type { Observation, ObservationOutcome, ObservationSource } from '../../generated/prisma/client.js';
import { clampPage, type DbClient, type JsonInput, type PageOptions } from '../types.js';

export interface CreateObservationInput {
  nodeId: string;
  outcome: ObservationOutcome;
  latencyMs: number;
  source?: ObservationSource;
  observedAt?: Date;
  statusCode?: number;
  requestShape?: JsonInput;
  responseShape?: JsonInput;
  responseSample?: JsonInput;
  headers?: JsonInput;
  errorMessage?: string;
  shapeHash?: string;
}

export interface ListObservationsFilter extends PageOptions {
  nodeId: string;
  outcome?: ObservationOutcome;
  since?: Date;
}

export class ObservationRepository {
  constructor(private readonly db: DbClient) {}

  create(input: CreateObservationInput): Promise<Observation> {
    return this.db.observation.create({ data: input });
  }

  findById(id: string): Promise<Observation | null> {
    return this.db.observation.findUnique({ where: { id } });
  }

  /** Newest first. */
  listForNode(filter: ListObservationsFilter): Promise<Observation[]> {
    const { take, skip } = clampPage(filter);
    return this.db.observation.findMany({
      where: {
        nodeId: filter.nodeId,
        ...(filter.outcome !== undefined ? { outcome: filter.outcome } : {}),
        ...(filter.since !== undefined ? { observedAt: { gte: filter.since } } : {}),
      },
      orderBy: { observedAt: 'desc' },
      take,
      skip,
    });
  }

  latestForNode(nodeId: string): Promise<Observation | null> {
    return this.db.observation.findFirst({ where: { nodeId }, orderBy: { observedAt: 'desc' } });
  }

  countByOutcome(nodeId: string, since?: Date): Promise<Array<{ outcome: ObservationOutcome; count: number }>> {
    return this.db.observation
      .groupBy({
        by: ['outcome'],
        where: { nodeId, ...(since !== undefined ? { observedAt: { gte: since } } : {}) },
        _count: { _all: true },
      })
      .then((rows) => rows.map((r) => ({ outcome: r.outcome, count: r._count._all })));
  }
}
