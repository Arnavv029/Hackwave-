import type { DependencyNode, NodeKind, Criticality } from '../../generated/prisma/client.js';
import { clampPage, type DbClient, type JsonInput, type PageOptions } from '../types.js';

export interface CreateDependencyNodeInput {
  kind: NodeKind;
  key: string;
  name: string;
  parentId?: string;
  enabled?: boolean;
  criticality?: Criticality;
  baseUrl?: string;
  secretRef?: string;
  method?: string;
  path?: string;
  metadata?: JsonInput;
}

export type UpdateDependencyNodeInput = Partial<Omit<CreateDependencyNodeInput, 'kind' | 'key'>>;

export interface ListDependencyNodesFilter extends PageOptions {
  kind?: NodeKind;
  enabled?: boolean;
  parentId?: string;
}

export class DependencyNodeRepository {
  constructor(private readonly db: DbClient) {}

  create(input: CreateDependencyNodeInput): Promise<DependencyNode> {
    return this.db.dependencyNode.create({ data: input });
  }

  /** Idempotent create keyed by `key`; updates mutable fields if it exists. */
  upsertByKey(input: CreateDependencyNodeInput): Promise<DependencyNode> {
    const { key, kind, ...rest } = input;
    return this.db.dependencyNode.upsert({
      where: { key },
      create: { key, kind, ...rest },
      update: rest,
    });
  }

  findById(id: string): Promise<DependencyNode | null> {
    return this.db.dependencyNode.findUnique({ where: { id } });
  }

  findByKey(key: string): Promise<DependencyNode | null> {
    return this.db.dependencyNode.findUnique({ where: { key } });
  }

  list(filter: ListDependencyNodesFilter = {}): Promise<DependencyNode[]> {
    const { take, skip } = clampPage(filter);
    return this.db.dependencyNode.findMany({
      where: {
        ...(filter.kind !== undefined ? { kind: filter.kind } : {}),
        ...(filter.enabled !== undefined ? { enabled: filter.enabled } : {}),
        ...(filter.parentId !== undefined ? { parentId: filter.parentId } : {}),
      },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
      take,
      skip,
    });
  }

  update(id: string, input: UpdateDependencyNodeInput): Promise<DependencyNode> {
    return this.db.dependencyNode.update({ where: { id }, data: input });
  }

  setEnabled(id: string, enabled: boolean): Promise<DependencyNode> {
    return this.db.dependencyNode.update({ where: { id }, data: { enabled } });
  }

  /** Deletes the node and, via cascades, its edges, observations, baselines and findings. */
  delete(id: string): Promise<DependencyNode> {
    return this.db.dependencyNode.delete({ where: { id } });
  }
}
