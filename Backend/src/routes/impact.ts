import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import type { GraphService } from '../graph/service.js';
import { persistImpactBodySchema, traversalLimitsSchema } from '../graph/schemas.js';

export interface ImpactRouterDeps {
  service: GraphService;
  requireOperator: RequestHandler;
}

const idSchema = z.string().uuid();

/**
 *   GET  /api/findings/:id/impact           live impact report for a finding
 *   POST /api/findings/:id/impact           compute and persist a snapshot (operator)
 *   GET  /api/findings/:id/impact/reports   persisted snapshots for the finding
 *   GET  /api/impact-reports/:id            one snapshot
 */
export function createFindingImpactRouter(deps: ImpactRouterDeps): Router {
  const router = Router({ mergeParams: true });
  const findingId = (params: unknown): string => parseId((params as { id?: unknown }).id);

  router.get('/', async (req, res) => {
    const id = findingId(req.params);
    const limits = traversalLimitsSchema.parse(req.query);
    res.json({ data: await deps.service.impactForFinding(id, limits) });
  });

  router.post('/', deps.requireOperator, async (req, res) => {
    const id = findingId(req.params);
    const { createdBy, ...overrides } = persistImpactBodySchema.parse(req.body ?? {});
    const limits = traversalLimitsSchema.parse(overrides);
    const report = await deps.service.impactForFinding(id, limits);
    const saved = await deps.service.persistReport(report, createdBy);
    res.status(201).json({ data: { id: saved.id, createdAt: saved.createdAt.toISOString(), createdBy: saved.createdBy, report } });
  });

  router.get('/reports', async (req, res) => {
    const id = findingId(req.params);
    const rows = await deps.service.listReportsForFinding(id);
    res.json({ data: rows.map(({ report: _r, ...meta }) => ({ ...meta, createdAt: meta.createdAt.toISOString() })) });
  });

  return router;
}

export function createImpactReportsRouter(deps: Pick<ImpactRouterDeps, 'service'>): Router {
  const router = Router();
  router.get('/:id', async (req, res) => {
    const r = await deps.service.getReport(parseId(req.params['id']));
    res.json({ data: { ...r, createdAt: r.createdAt.toISOString() } });
  });
  return router;
}

function parseId(raw: unknown): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundError('Not found');
  return parsed.data;
}
