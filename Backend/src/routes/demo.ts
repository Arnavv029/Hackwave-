import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import { DEMO_CATALOG, findDemoEndpoint, type DemoStore } from '../mocks/demo.router.js';
import type { GuardianService } from '../guardian/service.js';
import { actorSchema } from '../guardian/schemas.js';

/**
 * The five showcase APIs registered by default. Each demonstrates a different
 * kind of provider misbehaviour so the UI stays readable in the initial phase.
 */
export const STARTER_KEYS = ['users-profile', 'geo-location', 'orders-recent', 'inventory-stock', 'auth-session'];

export interface DemoRouterDeps {
  store: DemoStore;
  service: GuardianService;
  /** Absolute base of the mock providers as the backend reaches them (e.g. http://127.0.0.1:3000/mock). */
  mockBaseUrl: () => string;
  requireOperator: RequestHandler;
}

/**
 *   GET  /api/demo/catalog               showcase endpoints with absolute URLs, what they demonstrate, live drift state
 *   POST /api/demo/register-all          register the 5 starter showcase endpoints (or `keys` / `all: true`) as monitors (operator)
 *   POST /api/demo/:key/drift | restore  force an endpoint to misbehave / behave (operator)
 *   POST /api/demo/reset                 reset counters (optionally set driftAfter) (operator)
 */
export function createDemoRouter(deps: DemoRouterDeps): Router {
  const r = Router();
  const urlFor = (path: string) => `${deps.mockBaseUrl().replace(/\/$/, '')}/demo${path}`;

  r.get('/catalog', async (_req, res) => {
    const monitors = await deps.service.listMonitors();
    res.json({
      data: {
        driftAfterMs: deps.store.driftAfterMs,
        endpoints: DEMO_CATALOG.map((e) => {
          const url = urlFor(e.path);
          const registered = monitors.find((m) => m.url === url && m.method === e.method);
          return { ...e, url, state: deps.store.state(e.key), monitorId: registered?.id ?? null, health: registered?.health ?? null };
        }),
      },
    });
  });

  r.post('/register-all', deps.requireOperator, async (req, res) => {
    const { actor, intervalSec, keys, all } = z.object({ actor: actorSchema.default('demo'), intervalSec: z.number().int().min(10).max(3600).default(60), keys: z.array(z.string()).optional(), all: z.boolean().default(false) }).strict().parse(req.body ?? {});
    // Keep the initial phase small: without an explicit `keys` list (or `all: true`) only the starter set is registered.
    const wanted = all ? null : keys ?? STARTER_KEYS;
    const monitors = await deps.service.listMonitors();
    const results: Array<{ key: string; monitorId: string; created: boolean; health: string }> = [];
    for (const e of DEMO_CATALOG) {
      if (wanted && !wanted.includes(e.key)) continue;
      const url = urlFor(e.path);
      const existing = monitors.find((m) => m.url === url && m.method === e.method);
      if (existing) {
        results.push({ key: e.key, monitorId: existing.id, created: false, health: existing.health });
        continue;
      }
      const m = await deps.service.createMonitor({ name: e.name, url, method: e.method, environment: 'Staging', description: e.demonstrates, intervalSec, timeoutMs: 5_000, authType: 'NONE', headers: {}, ...(e.requestBody ? { body: e.requestBody } : {}), autoBaseline: true, createdBy: actor });
      for (const map of e.mappings) await deps.service.createMapping(m.id, { feature: map.feature, jsonPath: map.jsonPath, route: map.route, impactLevel: map.impactLevel, createdBy: actor });
      results.push({ key: e.key, monitorId: m.id, created: true, health: m.health });
    }
    res.status(201).json({ data: results });
  });

  r.post('/reset', deps.requireOperator, (req, res) => {
    const { driftAfterSec, key } = z.object({ driftAfterSec: z.number().int().min(0).max(86_400).optional(), key: z.string().optional() }).strict().parse(req.body ?? {});
    deps.store.reset(key, driftAfterSec === undefined ? undefined : driftAfterSec * 1_000);
    res.json({ data: { driftAfterMs: deps.store.driftAfterMs, reset: key ?? 'all' } });
  });

  r.post('/:key/:mode', deps.requireOperator, (req, res) => {
    const key = String(req.params['key']);
    const mode = String(req.params['mode']);
    if (!findDemoEndpoint(key)) throw new NotFoundError(`Unknown demo endpoint ${key}`);
    if (mode !== 'drift' && mode !== 'restore') throw new NotFoundError('Unknown action');
    deps.store.force(key, mode);
    res.json({ data: { key, state: deps.store.state(key) } });
  });
  return r;
}
