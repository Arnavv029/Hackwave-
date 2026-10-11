import { Router } from 'express';
import { createPaymentsMockRouter } from './payments.router.js';
import { createShippingMockRouter } from './shipping.router.js';
import type { ScenarioStore } from './scenarios.js';
import { createDemoMockRouter, type DemoStore } from './demo.router.js';

/**
 * Mock Payments and Shipping providers, mounted under `/mock/<provider>`.
 * They have no state beyond the scenario store and never require credentials
 * (anything in `Authorization` is ignored, which lets tests prove the engine
 * redacts what it sent).
 */
export function createMockProvidersRouter(store: ScenarioStore, demoStore?: DemoStore): Router {
  const router = Router();
  router.use('/payments', createPaymentsMockRouter(store));
  router.use('/shipping', createShippingMockRouter(store));
  if (demoStore) router.use('/demo', createDemoMockRouter(demoStore));
  router.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `unknown mock provider ${req.path}` } });
  });
  return router;
}

export * from './scenarios.js';
export * from './demo.router.js';
