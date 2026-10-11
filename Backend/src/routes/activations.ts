import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { safetySchema, type ActivationService } from '../activation/service.js';
import { actorSchema } from '../repair/schemas.js';

export interface ActivationRouterDeps {
  service: ActivationService;
  requireOperator: RequestHandler;
}
const target = z.object({ adapterKey: z.string().min(1).max(200), endpointKey: z.string().min(1).max(256) });
const iso = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/**
 *   GET   /api/activations                                   every active-version pointer
 *   GET   /api/activations/current?adapterKey=&endpointKey=  pointer + active version + history + verifications
 *   POST  /api/activations/verify                            { adapterKey, endpointKey, probes?, triggeredBy } (operator)
 *   POST  /api/activations/rollback                          { adapterKey, endpointKey, actor, reason } (operator)
 *   PATCH /api/activations/safety                            { adapterKey, endpointKey, actor, safety } (operator)
 */
export function createActivationsRouter(deps: ActivationRouterDeps): Router {
  const r = Router();
  r.get('/', async (_req, res) => {
    res.json({ data: iso(await deps.service.listPointers()) });
  });
  r.get('/current', async (req, res) => {
    const q = target.strict().parse(req.query);
    res.json({ data: iso(await deps.service.pointerWithHistory(q.adapterKey, q.endpointKey)) });
  });
  r.post('/verify', deps.requireOperator, async (req, res) => {
    const b = target.extend({ probes: z.number().int().min(1).max(20).optional(), triggeredBy: actorSchema.default('system') }).strict().parse(req.body);
    res.json({ data: iso(await deps.service.verify(b.adapterKey, b.endpointKey, b.triggeredBy, b.probes)) });
  });
  r.post('/rollback', deps.requireOperator, async (req, res) => {
    const b = target.extend({ actor: actorSchema, reason: z.string().min(1).max(500) }).strict().parse(req.body);
    res.json({ data: iso(await deps.service.rollbackPointer(b.adapterKey, b.endpointKey, b.actor, b.reason)) });
  });
  r.patch('/safety', deps.requireOperator, async (req, res) => {
    const b = target.extend({ actor: actorSchema, safety: safetySchema }).strict().parse(req.body);
    res.json({ data: iso(await deps.service.setSafety(b.adapterKey, b.endpointKey, b.safety, b.actor)) });
  });
  return r;
}
