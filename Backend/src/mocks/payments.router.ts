import { createHash } from 'node:crypto';
import { Router } from 'express';
import { chargeRequestSchema, endpointKey, paymentsContract, type Charge } from '../providers/contracts.js';
import { mapRecords, respondWithScenario } from './fault-layer.js';
import type { Scenario, ScenarioStore } from './scenarios.js';

/** Deterministic id from the request so repeated probes look like one provider. */
function chargeId(seed: string): string {
  return `txn_${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}

function applyPaymentsScenario(scenario: Scenario, body: Record<string, unknown>): Record<string, unknown> {
  return mapRecords(body, (r) => {
    switch (scenario) {
      case 'schema_rename': {
        // Silent rename: same data, different key, still HTTP 200.
        const { transaction_id, ...rest } = r;
        return { payment_reference: transaction_id, ...rest };
      }
      case 'unsafe_data':
        return { ...r, amount: -Math.abs(Number(r['amount'] ?? 0)) || -1 };
      default:
        return r;
    }
  });
}

export function createPaymentsMockRouter(store: ScenarioStore): Router {
  const router = Router();
  const create = paymentsContract.endpoints.createCharge;
  const get = paymentsContract.endpoints.getCharge;

  router.post('/charges', (req, res) => {
    const parsed = chargeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'invalid charge request', issues: parsed.error.issues.map((i) => i.path.join('.')) },
      });
      return;
    }
    const input = parsed.data;
    const charge: Charge = {
      transaction_id: chargeId(input.idempotency_key ?? `${input.amount}:${input.currency}:${input.source_token}`),
      amount: input.amount,
      currency: input.currency,
      status: 'succeeded',
      created_at: new Date().toISOString(),
    };
    respondWithScenario(store, req, res, {
      provider: 'payments',
      endpointKey: endpointKey(create),
      status: 201,
      body: charge,
      defaultField: 'transaction_id',
      applyProviderScenario: applyPaymentsScenario,
    });
  });

  router.get('/charges/:id', (req, res) => {
    const id = String(req.params['id']);
    if (!/^txn_[A-Za-z0-9]+$/.test(id)) {
      res.status(404).json({ error: { code: 'not_found', message: 'no such charge' } });
      return;
    }
    const charge: Charge = {
      transaction_id: id,
      amount: 4_999,
      currency: 'USD',
      status: 'succeeded',
      created_at: '2026-10-01T12:00:00.000Z',
    };
    respondWithScenario(store, req, res, {
      provider: 'payments',
      endpointKey: endpointKey(get),
      body: charge,
      defaultField: 'transaction_id',
      applyProviderScenario: applyPaymentsScenario,
    });
  });

  router.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `no route ${req.method} ${req.path}` } });
  });

  return router;
}
