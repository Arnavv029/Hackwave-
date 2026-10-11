import type { DependencyEdge, EdgeRelation } from '../../generated/prisma/client.js';
import type { DbClient } from '../types.js';

export interface CreateDependencyEdgeInput {
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  note?: string;
}

export class DependencyEdgeRepository {
  constructor(private readonly db: DbClient) {}

  create(input: CreateDependencyEdgeInput): Promise<DependencyEdge> {
    return this.db.dependencyEdge.create({ data: input });
  }

  /** Idempotent: an edge is identified by (source, target, relation). */
  upsert(input: CreateDependencyEdgeInput): Promise<DependencyEdge> {
    const { sourceId, targetId, relation, note } = input;
    return this.db.dependencyEdge.upsert({
      where: { sourceId_targetId_relation: { sourceId, targetId, relation } },
      create: input,
      update: { note: note ?? null },
    });
  }

  findById(id: string): Promise<DependencyEdge | null> {
    return this.db.dependencyEdge.findUnique({ where: { id } });
  }

  /** Edges leaving `nodeId` (what this node feeds). */
  listOutgoing(nodeId: string): Promise<DependencyEdge[]> {
    return this.db.dependencyEdge.findMany({ where: { sourceId: nodeId }, orderBy: { createdAt: 'asc' } });
  }

  /** Edges entering `nodeId` (what this node depends on). */
  listIncoming(nodeId: string): Promise<DependencyEdge[]> {
    return this.db.dependencyEdge.findMany({ where: { targetId: nodeId }, orderBy: { createdAt: 'asc' } });
  }

  listAll(): Promise<DependencyEdge[]> {
    return this.db.dependencyEdge.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /**
   * Transitive downstream closure of `nodeId` following edge direction.
   * Used by impact analysis: an OPERATION's downstream set contains the
   * CLIENTs and WORKFLOWs that will be affected by a change to it.
   */
  async downstreamIds(nodeId: string): Promise<string[]> {
    const edges = await this.listAll();
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const targets = adjacency.get(edge.sourceId) ?? [];
      targets.push(edge.targetId);
      adjacency.set(edge.sourceId, targets);
    }
    const seen = new Set<string>();
    const stack = [...(adjacency.get(nodeId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      stack.push(...(adjacency.get(current) ?? []));
    }
    return [...seen];
  }

  delete(id: string): Promise<DependencyEdge> {
    return this.db.dependencyEdge.delete({ where: { id } });
  }
}
