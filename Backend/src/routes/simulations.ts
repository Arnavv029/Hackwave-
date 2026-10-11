import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { requireBearerToken } from '../middleware/bearer-auth.js';
import { providerKeySchema } from '../providers/contracts.js';
import {
  SCENARIOS,
  SCENARIO_PROVIDERS,
  ScenarioNotApplicableError,
  scenarioOptionsSchema,
  scenarioSchema,
  type ScenarioStore,
} from '../mocks/scenarios.js';

export interface SimulationRouterDeps {
  store: ScenarioStore;
  /** Shared secret; the router refuses to be built without one. */
  controlToken: string;
}

const paramsSchema = z.object({ provider: providerKeySchema, scenario: scenarioSchema }).strict();
const providerParamsSchema = z.object({ provider: providerKeySchema }).strict();
const bodySchema = z.object({ options: scenarioOptionsSchema.default({}) }).strict().default({ options: {} });

/**
 * Scenario controls (development/test only). Mounted at /api/simulations by
 * the app ONLY when NODE_ENV !== production and a control token is set.
 */
export function createSimulationsRouter(deps: SimulationRouterDeps): Router {
  if (!deps.controlToken) throw new Error('simulations router requires a control token');
  const router = Router();
  router.use(requireBearerToken(deps.controlToken));

  router.get('/', (_req, res) => {
    res.json({
      active: deps.store.snapshot(),
      catalog: SCENARIOS.map((scenario) => ({ scenario, providers: SCENARIO_PROVIDERS[scenario] ?? 'all' })),
    });
  });

  router.post('/:provider/:scenario', (req, res) => {
    const { provider, scenario } = paramsSchema.parse(req.params);
    const { options } = bodySchema.parse(req.body ?? {});
    try {
      const active = deps.store.activate(provider, scenario, options);
      req.log.info({ provider, scenario, options }, 'mock scenario activated');
      res.status(200).json({ active });
    } catch (err) {
      if (err instanceof ScenarioNotApplicableError) {
        throw new ValidationError(err.message, { scenario, applicableTo: SCENARIO_PROVIDERS[scenario] });
      }
      throw err;
    }
  });

  router.delete('/:provider', (req, res) => {
    const { provider } = providerParamsSchema.parse(req.params);
    deps.store.reset(provider);
    req.log.info({ provider }, 'mock scenario reset');
    res.json({ active: deps.store.get(provider) });
  });

  router.delete('/', (req, res) => {
    deps.store.reset();
    req.log.info('all mock scenarios reset');
    res.json({ active: deps.store.snapshot() });
  });

  return router;
}
