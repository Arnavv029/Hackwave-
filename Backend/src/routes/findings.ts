import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import { findingStatusChangeSchema, listFindingsQuerySchema, type FindingService } from '../detection/detection-service.js';
import { RULE_IDS } from '../detection/rules.js';
import type { FindingRecord } from '../detection/stores.js';

export interface FindingRouterDeps {
  service: FindingService;
  requireOperator: RequestHandler;
}

const idSchema = z.string().uuid();

export function toFindingWire(f: FindingRecord): Record<string, unknown> {
  return {
    ...f,
    firstSeenAt: f.firstSeenAt.toISOString(),
    lastSeenAt: f.lastSeenAt.toISOString(),
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    statusChangedAt: f.statusChangedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

/**
 *   GET   /api/findings            list (filters: provider, endpoint, status, severity, category, kind, rule, baselineId)
 *   GET   /api/findings/rules      the deterministic rule catalogue
 *   GET   /api/findings/:id        one finding with evidence
 *   PATCH /api/findings/:id/status lifecycle: OPEN | ACKNOWLEDGED | RESOLVED | FALSE_POSITIVE
 */
export function createFindingsRouter(deps: FindingRouterDeps): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = listFindingsQuerySchema.parse(req.query);
    const page = await deps.service.list(q);
    res.json({ data: page.rows.map(toFindingWire), page: { limit: q.limit, offset: q.offset, total: page.total, hasMore: q.offset + page.rows.length < page.total } });
  });

  router.get('/rules', (_req, res) => {
    res.json({ data: RULE_IDS.map((rule) => ({ rule, kind: rule.startsWith('operational.') || rule.startsWith('availability.') || rule.startsWith('rate_limit.') ? 'STATISTICAL' : 'STRUCTURAL' })) });
  });

  router.get('/:id', async (req, res) => {
    const parsed = idSchema.safeParse(req.params['id']);
    if (!parsed.success) throw new NotFoundError('Finding not found');
    res.json({ data: toFindingWire(await deps.service.get(parsed.data)) });
  });

  router.patch('/:id/status', deps.requireOperator, async (req, res) => {
    const parsed = idSchema.safeParse(req.params['id']);
    if (!parsed.success) throw new NotFoundError('Finding not found');
    const body = findingStatusChangeSchema.parse(req.body);
    res.json({ data: toFindingWire(await deps.service.changeStatus(parsed.data, body)) });
  });

  return router;
}
