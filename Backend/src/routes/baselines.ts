import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import { actorSchema, createBaselineSchema, listBaselinesQuerySchema, reviewBaselineSchema, type BaselineService } from '../detection/baseline-service.js';
import type { BaselineRecord } from '../detection/stores.js';

export interface BaselineRouterDeps {
  service: BaselineService;
  /** Guards state-changing routes; pass-through when operator auth is disabled. */
  requireOperator: RequestHandler;
}

const idSchema = z.string().uuid();
const actorBody = z.object({ actor: actorSchema }).strict();
const compareQuery = z.object({ from: idSchema, to: idSchema }).strict();

export function toBaselineWire(b: BaselineRecord, includeSummary: boolean): Record<string, unknown> {
  const { summary, ...rest } = b;
  return {
    ...rest,
    windowFrom: b.windowFrom.toISOString(),
    windowTo: b.windowTo.toISOString(),
    reviewedAt: b.reviewedAt?.toISOString() ?? null,
    activatedAt: b.activatedAt?.toISOString() ?? null,
    supersededAt: b.supersededAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    ...(includeSummary ? { summary } : { summary: { sampleCount: summary.sampleCount, fieldCount: Object.keys(summary.fields).length, statusCodes: summary.statusCodes } }),
  };
}

/**
 *   POST  /api/baselines                      create a DRAFT from an observation window
 *   GET   /api/baselines                      list (filters: provider, endpoint, status)
 *   GET   /api/baselines/compare?from=&to=    before/after report between two versions
 *   GET   /api/baselines/:id                  full record incl. summary
 *   POST  /api/baselines/:id/submit           DRAFT -> PENDING_REVIEW
 *   POST  /api/baselines/:id/review           PENDING_REVIEW -> APPROVED | REJECTED
 *   POST  /api/baselines/:id/promote          APPROVED -> ACTIVE (supersedes previous ACTIVE)
 */
export function createBaselinesRouter(deps: BaselineRouterDeps): Router {
  const router = Router();
  const { service } = deps;

  router.post('/', deps.requireOperator, async (req, res) => {
    const input = createBaselineSchema.parse(req.body);
    const record = await service.createDraft(input);
    res.status(201).json({ data: toBaselineWire(record, true) });
  });

  router.get('/', async (req, res) => {
    const q = listBaselinesQuerySchema.parse(req.query);
    const page = await service.list(q);
    res.json({ data: page.rows.map((b) => toBaselineWire(b, false)), page: { limit: q.limit, offset: q.offset, total: page.total, hasMore: q.offset + page.rows.length < page.total } });
  });

  router.get('/compare', async (req, res) => {
    const q = compareQuery.parse(req.query);
    res.json({ data: await service.compare(q.from, q.to) });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params['id']);
    res.json({ data: toBaselineWire(await service.get(id), true) });
  });

  router.post('/:id/submit', deps.requireOperator, async (req, res) => {
    const id = parseId(req.params['id']);
    const { actor } = actorBody.parse(req.body ?? {});
    res.json({ data: toBaselineWire(await service.submitForReview(id, actor), false) });
  });

  router.post('/:id/review', deps.requireOperator, async (req, res) => {
    const id = parseId(req.params['id']);
    const body = reviewBaselineSchema.parse(req.body);
    res.json({ data: toBaselineWire(await service.review(id, body.decision, body.reviewer, body.note), false) });
  });

  router.post('/:id/promote', deps.requireOperator, async (req, res) => {
    const id = parseId(req.params['id']);
    const { actor } = actorBody.parse(req.body ?? {});
    res.json({ data: toBaselineWire(await service.promote(id, actor), false) });
  });

  return router;
}

function parseId(raw: unknown): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new NotFoundError('Baseline not found');
  return parsed.data;
}
