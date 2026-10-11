import { Router } from 'express';
import { endpointKey, shipmentListQuerySchema, shippingContract, type Shipment, type ShipmentList } from '../providers/contracts.js';
import { mapRecords, respondWithScenario } from './fault-layer.js';
import type { Scenario, ScenarioStore } from './scenarios.js';

const FIXTURES: readonly Shipment[] = [
  { shipment_id: 'shp_1001', order_id: 'ord_501', carrier: 'UPS', delivery_status: 'shipped', estimated_delivery: '2026-10-14' },
  { shipment_id: 'shp_1002', order_id: 'ord_502', carrier: 'FedEx', delivery_status: 'shipped', estimated_delivery: '2026-10-15' },
  { shipment_id: 'shp_1003', order_id: 'ord_503', carrier: 'DHL', delivery_status: 'delivered', estimated_delivery: '2026-10-09' },
  { shipment_id: 'shp_1004', order_id: 'ord_504', carrier: 'UPS', delivery_status: 'pending', estimated_delivery: '2026-10-20' },
  { shipment_id: 'shp_1005', order_id: 'ord_505', carrier: 'USPS', delivery_status: 'shipped', estimated_delivery: '2026-10-16' },
];

function applyShippingScenario(scenario: Scenario, body: Record<string, unknown>): Record<string, unknown> {
  return mapRecords(body, (r) => {
    if (scenario === 'semantic_change' && r['delivery_status'] === 'shipped') {
      // Same key, same type, new vocabulary: workflows that switch on `shipped` silently break.
      return { ...r, delivery_status: 'in_transit' };
    }
    return r;
  });
}

export function createShippingMockRouter(store: ScenarioStore): Router {
  const router = Router();
  const list = shippingContract.endpoints.listShipments;
  const get = shippingContract.endpoints.getShipment;

  router.get('/shipments', (req, res) => {
    const parsed = shipmentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'invalid pagination' } });
      return;
    }
    const { page, size } = parsed.data;
    const start = (page - 1) * size;
    const body: ShipmentList = {
      data: FIXTURES.slice(start, start + size),
      page: { number: page, size, total: FIXTURES.length },
    };
    respondWithScenario(store, req, res, {
      provider: 'shipping',
      endpointKey: endpointKey(list),
      body,
      defaultField: 'delivery_status',
      applyProviderScenario: applyShippingScenario,
    });
  });

  router.get('/shipments/:id', (req, res) => {
    const id = String(req.params['id']);
    const found = FIXTURES.find((s) => s.shipment_id === id);
    if (!found) {
      res.status(404).json({ error: { code: 'not_found', message: 'no such shipment' } });
      return;
    }
    respondWithScenario(store, req, res, {
      provider: 'shipping',
      endpointKey: endpointKey(get),
      body: { ...found },
      defaultField: 'delivery_status',
      applyProviderScenario: applyShippingScenario,
    });
  });

  router.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `no route ${req.method} ${req.path}` } });
  });

  return router;
}
