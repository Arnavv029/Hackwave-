import { randomUUID } from 'node:crypto';
import { Prisma, type Observation } from '../generated/prisma/client.js';
import type { DbClient } from '../db/types.js';
import { endpointKey as toEndpointKey, operationNodeKey, providerContracts, type EndpointContract, type ProviderKey } from '../providers/contracts.js';
import type { FieldPath, ListObservationsQuery, ObservationRecord } from './schemas.js';

/**
 * Persistence seam for the engine. The Prisma implementation is used by the
 * server; the in-memory one keeps unit tests hermetic. Both preserve every
 * record (append-only) so history is never rewritten.
 */

export interface StoredObservation extends ObservationRecord {
  id: string;
  nodeId: string;
  createdAt: Date;
}

export interface ObservationPage {
  rows: StoredObservation[];
  total: number;
}

export interface EndpointIdentity {
  provider: ProviderKey;
  endpoint: EndpointContract;
  baseUrl: string;
}

export interface ObservationStore {
  save(record: ObservationRecord, identity: EndpointIdentity): Promise<StoredObservation>;
  /** Most recent observation for the endpoint that produced a JSON shape. */
  latestWithShape(providerKey: ProviderKey, endpointKey: string): Promise<Pick<StoredObservation, 'id' | 'fieldPaths'> | null>;
  findById(id: string): Promise<StoredObservation | null>;
  list(query: ListObservationsQuery): Promise<ObservationPage>;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

export class PrismaObservationStore implements ObservationStore {
  constructor(private readonly db: DbClient) {}

  async save(record: ObservationRecord, identity: EndpointIdentity): Promise<StoredObservation> {
    const nodeId = await this.ensureOperationNode(identity);
    const row = await this.db.observation.create({
      data: {
        nodeId,
        source: 'PROBE',
        observedAt: record.observedAt,
        outcome: record.outcome,
        errorCategory: record.errorCategory,
        statusCode: record.statusCode,
        latencyMs: record.latencyMs,
        providerKey: record.providerKey,
        endpointKey: record.endpointKey,
        method: record.method,
        parseOutcome: record.parseOutcome,
        responseBytes: record.responseBytes,
        correlationId: record.correlationId,
        scenario: record.scenario,
        requestMeta: toJson(record.requestMeta),
        headers: toJson(record.responseHeaders),
        fieldPaths: record.fieldPaths === null ? undefined : toJson(record.fieldPaths),
        shapeHash: record.shapeHash,
        shapeDelta: record.shapeDelta === null ? undefined : toJson(record.shapeDelta),
        responseSample: record.responseSample === undefined || record.responseSample === null ? undefined : toJson(record.responseSample),
        contractCheck: toJson(record.contractCheck),
        errorMessage: record.errorMessage,
      },
    });
    return fromRow(row);
  }

  async latestWithShape(providerKey: ProviderKey, endpointKey: string): Promise<Pick<StoredObservation, 'id' | 'fieldPaths'> | null> {
    const row = await this.db.observation.findFirst({
      where: { providerKey, endpointKey, parseOutcome: 'JSON', fieldPaths: { not: Prisma.DbNull } },
      orderBy: { observedAt: 'desc' },
      select: { id: true, fieldPaths: true },
    });
    if (!row) return null;
    return { id: row.id, fieldPaths: (row.fieldPaths as FieldPath[] | null) ?? [] };
  }

  async findById(id: string): Promise<StoredObservation | null> {
    const row = await this.db.observation.findUnique({ where: { id } });
    return row ? fromRow(row) : null;
  }

  async list(query: ListObservationsQuery): Promise<ObservationPage> {
    const where: Prisma.ObservationWhereInput = {
      ...(query.provider ? { providerKey: query.provider } : {}),
      ...(query.endpoint ? { endpointKey: query.endpoint } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.status !== undefined ? { statusCode: query.status } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.errorCategory ? { errorCategory: query.errorCategory } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.from || query.to
        ? { observedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.observation.findMany({
        where,
        orderBy: [{ observedAt: query.sort }, { id: query.sort }],
        take: query.limit,
        skip: query.offset,
      }),
      this.db.observation.count({ where }),
    ]);
    return { rows: rows.map(fromRow), total };
  }

  /** Make sure PROVIDER and OPERATION nodes (and the EXPOSES edge) exist. */
  private async ensureOperationNode(identity: EndpointIdentity): Promise<string> {
    const contract = providerContracts[identity.provider];
    const provider = await this.db.dependencyNode.upsert({
      where: { key: contract.key },
      create: { kind: 'PROVIDER', key: contract.key, name: contract.name, baseUrl: identity.baseUrl, secretRef: contract.secretRef },
      update: { baseUrl: identity.baseUrl },
    });
    const opKey = operationNodeKey(identity.provider, identity.endpoint);
    const op = await this.db.dependencyNode.upsert({
      where: { key: opKey },
      create: {
        kind: 'OPERATION',
        key: opKey,
        name: toEndpointKey(identity.endpoint),
        parentId: provider.id,
        method: identity.endpoint.method,
        path: identity.endpoint.path,
      },
      update: {},
    });
    await this.db.dependencyEdge.upsert({
      where: { sourceId_targetId_relation: { sourceId: provider.id, targetId: op.id, relation: 'EXPOSES' } },
      create: { sourceId: provider.id, targetId: op.id, relation: 'EXPOSES' },
      update: {},
    });
    return op.id;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function fromRow(row: Observation): StoredObservation {
  return {
    id: row.id,
    nodeId: row.nodeId,
    createdAt: row.createdAt,
    providerKey: (row.providerKey ?? 'payments') as ProviderKey,
    endpointKey: row.endpointKey ?? '',
    method: (row.method ?? 'GET') as StoredObservation['method'],
    observedAt: row.observedAt,
    latencyMs: row.latencyMs,
    outcome: row.outcome,
    errorCategory: row.errorCategory,
    statusCode: row.statusCode,
    parseOutcome: row.parseOutcome ?? 'NOT_READ',
    responseBytes: row.responseBytes ?? 0,
    correlationId: row.correlationId,
    scenario: row.scenario,
    requestMeta: row.requestMeta as StoredObservation['requestMeta'],
    responseHeaders: (row.headers as StoredObservation['responseHeaders'] | null) ?? { kept: {}, redacted: [], omitted: [] },
    fieldPaths: row.fieldPaths as FieldPath[] | null,
    shapeHash: row.shapeHash,
    shapeDelta: row.shapeDelta as StoredObservation['shapeDelta'],
    responseSample: row.responseSample,
    contractCheck: (row.contractCheck as StoredObservation['contractCheck'] | null) ?? { checked: false, valid: null, issues: [], issueCount: 0 },
    errorMessage: row.errorMessage,
  };
}

// ---------------------------------------------------------------------------
// In-memory (tests)
// ---------------------------------------------------------------------------

export class InMemoryObservationStore implements ObservationStore {
  readonly rows: StoredObservation[] = [];

  save(record: ObservationRecord, identity: EndpointIdentity): Promise<StoredObservation> {
    const stored: StoredObservation = {
      ...structuredClone(record),
      id: randomUUID(),
      nodeId: operationNodeKey(identity.provider, identity.endpoint),
      createdAt: new Date(),
    };
    this.rows.push(stored);
    return Promise.resolve(stored);
  }

  latestWithShape(providerKey: ProviderKey, endpointKey: string): Promise<Pick<StoredObservation, 'id' | 'fieldPaths'> | null> {
    const match = [...this.rows]
      .reverse()
      .find((r) => r.providerKey === providerKey && r.endpointKey === endpointKey && r.parseOutcome === 'JSON' && r.fieldPaths !== null);
    return Promise.resolve(match ? { id: match.id, fieldPaths: match.fieldPaths } : null);
  }

  findById(id: string): Promise<StoredObservation | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }

  list(query: ListObservationsQuery): Promise<ObservationPage> {
    const filtered = this.rows.filter(
      (r) =>
        (!query.provider || r.providerKey === query.provider) &&
        (!query.endpoint || r.endpointKey === query.endpoint) &&
        (!query.method || r.method === query.method) &&
        (query.status === undefined || r.statusCode === query.status) &&
        (!query.outcome || r.outcome === query.outcome) &&
        (!query.errorCategory || r.errorCategory === query.errorCategory) &&
        (!query.correlationId || r.correlationId === query.correlationId) &&
        (!query.from || r.observedAt >= query.from) &&
        (!query.to || r.observedAt <= query.to),
    );
    filtered.sort((a, b) => (query.sort === 'asc' ? 1 : -1) * (a.observedAt.getTime() - b.observedAt.getTime() || a.id.localeCompare(b.id)));
    return Promise.resolve({ rows: filtered.slice(query.offset, query.offset + query.limit), total: filtered.length });
  }
}
