import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import type { AiRepairService } from '../ai/service.js';
import { aiProposeSchema, dismissSchema, listAiProposalsQuerySchema, promoteSchema, aiProposalOutputSchema, SUPPORTED_TRANSFORM_TYPES } from '../ai/schemas.js';
import { SYSTEM_PROMPT } from '../ai/change-report.js';

export interface AiRouterDeps {
  service: AiRepairService;
  /** Mandatory for every route here, including reads: AI output is operator-only material. */
  requireOperator: RequestHandler;
}

const idSchema = z.string().uuid();
const iso = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/**
 *   POST /api/ai/proposals                 ask the model for a constrained proposal for a finding (operator)
 *   GET  /api/ai/proposals                 list; GET /:id detail
 *   POST /api/ai/proposals/:id/promote     human turns it into a DRAFT deterministic rule (operator)
 *   POST /api/ai/proposals/:id/dismiss     (operator)
 *   GET  /api/ai/schema                    the proposal output schema (JSON) and supported transforms
 */
export function createAiRouter(deps: AiRouterDeps): Router {
  const r = Router();
  r.use(deps.requireOperator);
  const s = deps.service;

  r.get('/schema', (_req, res) => {
    res.json({ data: { supportedTransformations: SUPPORTED_TRANSFORM_TYPES, outputSchema: z.toJSONSchema(aiProposalOutputSchema), systemPrompt: SYSTEM_PROMPT, enabled: s.enabled } });
  });
  r.post('/proposals', async (req, res) => {
    const { findingId, impactReportId, createdBy } = aiProposeSchema.parse(req.body);
    const out = await s.propose(findingId, createdBy, impactReportId);
    res.status(201).json({ data: iso(out) });
  });
  r.get('/proposals', async (req, res) => {
    const q = listAiProposalsQuerySchema.parse(req.query);
    const out = await s.list(q);
    res.json({ data: out.rows.map(iso), page: { limit: q.limit, offset: q.offset, total: out.total, hasMore: q.offset + out.rows.length < out.total } });
  });
  r.get('/proposals/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params['id']);
    if (!id.success) throw new NotFoundError('AI proposal not found');
    res.json({ data: iso(await s.get(id.data)) });
  });
  r.post('/proposals/:id/promote', async (req, res) => {
    const id = idSchema.safeParse(req.params['id']);
    if (!id.success) throw new NotFoundError('AI proposal not found');
    const { actor, note } = promoteSchema.parse(req.body);
    res.status(201).json({ data: iso(await s.promoteToRule(id.data, actor, note)) });
  });
  r.post('/proposals/:id/dismiss', async (req, res) => {
    const id = idSchema.safeParse(req.params['id']);
    if (!id.success) throw new NotFoundError('AI proposal not found');
    const { actor, note } = dismissSchema.parse(req.body);
    res.json({ data: iso(await s.dismiss(id.data, actor, note)) });
  });
  return r;
}
