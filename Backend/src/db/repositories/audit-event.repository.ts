import type { ActorType, AuditEntityType, AuditEvent } from '../../generated/prisma/client.js';
import { clampPage, type DbClient, type JsonInput, type PageOptions } from '../types.js';

export interface AppendAuditEventInput {
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  actorType?: ActorType;
  actorId?: string;
  details?: JsonInput;
  correlationId?: string;
}

export interface ListAuditEventsFilter extends PageOptions {
  entityType?: AuditEntityType;
  entityId?: string;
  correlationId?: string;
}

/** Append-only: there are intentionally no update or delete methods. */
export class AuditEventRepository {
  constructor(private readonly db: DbClient) {}

  append(input: AppendAuditEventInput): Promise<AuditEvent> {
    return this.db.auditEvent.create({ data: input });
  }

  list(filter: ListAuditEventsFilter = {}): Promise<AuditEvent[]> {
    const { take, skip } = clampPage(filter);
    return this.db.auditEvent.findMany({
      where: {
        ...(filter.entityType !== undefined ? { entityType: filter.entityType } : {}),
        ...(filter.entityId !== undefined ? { entityId: filter.entityId } : {}),
        ...(filter.correlationId !== undefined ? { correlationId: filter.correlationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
