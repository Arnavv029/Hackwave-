import { Router, type Request, type Response } from 'express';

/**
 * Showcase ("problem") APIs. Each endpoint answers healthily for the first
 * `driftAfter` calls and then misbehaves in one specific way, so a demo can
 * prove detection, impact tracing, repair and recovery on APIs that really
 * go wrong, not on APIs that stay correct. Operators can force drift or
 * restore any endpoint and reset the counters.
 *
 * Mounted under /mock/demo. No credentials; never mounted in production.
 */

export type DemoMode = 'drifts' | 'healthy' | 'broken' | 'flaky';

export interface DemoEndpoint {
  key: string;
  name: string;
  method: 'GET' | 'POST';
  path: string;
  /** drifts: healthy first, misbehaves later; healthy: always correct; broken: always failing; flaky: alternates. */
  mode: DemoMode;
  /** Short label of the failure type used in the UI. */
  failureType: 'rename' | 'nested_rename' | 'pagination' | 'type_change' | 'field_removed' | 'mixed' | 'value_change' | 'http_error' | 'timeout' | 'rate_limit' | 'malformed';
  demonstrates: string;
  expectedDetection: string;
  /** Suggested feature mappings (JSON path -> feature name) to show impact. */
  mappings: Array<{ feature: string; jsonPath: string; route: string; impactLevel: 'Critical' | 'High' | 'Medium' | 'Low' }>;
  /** Whether a declarative adapter is expected to repair it automatically. */
  autoRepairable: boolean;
  requestBody?: Record<string, unknown>;
}

export interface DemoEndpointState {
  calls: number;
  firstCalledAt: string | null;
  /** When a drifting endpoint will start misbehaving on its own (null when forced or not yet called). */
  driftsAt: string | null;
  forced: 'drift' | 'restore' | null;
  drifted: boolean;
}

/** Drifting endpoints change this long after their first call (like a provider deploying a change). */
export const DEFAULT_DRIFT_AFTER_MS = 120_000;

export class DemoStore {
  private readonly calls = new Map<string, number>();
  private readonly firstCall = new Map<string, number>();
  private readonly forced = new Map<string, 'drift' | 'restore'>();
  driftAfterMs = DEFAULT_DRIFT_AFTER_MS;
  /** Delay used by the slow endpoints. */
  slowMs = 7_000;
  now: () => number = () => Date.now();

  /** Register a call and report whether the endpoint should misbehave. */
  hit(key: string): { calls: number; drifted: boolean } {
    const calls = (this.calls.get(key) ?? 0) + 1;
    this.calls.set(key, calls);
    if (!this.firstCall.has(key)) this.firstCall.set(key, this.now());
    return { calls, drifted: this.isDrifted(key) };
  }
  isDrifted(key: string): boolean {
    const f = this.forced.get(key);
    if (f === 'drift') return true;
    if (f === 'restore') return false;
    const first = this.firstCall.get(key);
    return first !== undefined && this.now() - first >= this.driftAfterMs;
  }
  force(key: string, mode: 'drift' | 'restore'): void {
    this.forced.set(key, mode);
  }
  reset(key?: string, driftAfterMs?: number): void {
    if (driftAfterMs !== undefined) this.driftAfterMs = driftAfterMs;
    const keys = key ? [key] : [...new Set([...this.calls.keys(), ...this.forced.keys(), ...this.firstCall.keys()])];
    for (const k of keys) {
      this.calls.delete(k);
      this.forced.delete(k);
      this.firstCall.delete(k);
    }
  }
  state(key: string): DemoEndpointState {
    const calls = this.calls.get(key) ?? 0;
    const first = this.firstCall.get(key);
    const forced = this.forced.get(key) ?? null;
    return { calls, firstCalledAt: first ? new Date(first).toISOString() : null, driftsAt: first && !forced ? new Date(first + this.driftAfterMs).toISOString() : null, forced, drifted: this.isDrifted(key) };
  }
}

type Handler = (drifted: boolean, req: Request, res: Response, store: DemoStore) => void;

const now = () => new Date().toISOString();

const CATALOG_IMPL: Array<DemoEndpoint & { handle: Handler }> = [
  {
    key: 'users-profile',
    mode: 'drifts',
    name: 'User Profile API',
    method: 'GET',
    path: '/users/profile',
    failureType: 'rename',
    demonstrates: 'Silent field rename: `name` becomes `display_name` while the HTTP status stays 200.',
    expectedDetection: 'Incident "field renamed (name -> display_name)", mapped feature affected, adapter proposal with one rename operation, validation passes, promotion heals the incident.',
    mappings: [
      { feature: 'Profile card', jsonPath: '$.name', route: '/profile', impactLevel: 'Critical' },
      { feature: 'Team directory', jsonPath: '$.email', route: '/team', impactLevel: 'Medium' },
    ],
    autoRepairable: true,
    handle: (drifted, _req, res) => {
      const base = { id: 104, email: 'aman@example.com', role: 'admin', status: 'active', updated_at: now() };
      res.json(drifted ? { ...base, display_name: 'Aman Gupta' } : { ...base, name: 'Aman Gupta' });
    },
  },
  {
    key: 'geo-location',
    mode: 'drifts',
    name: 'Geo Location API',
    method: 'GET',
    path: '/geo/location',
    failureType: 'nested_rename',
    demonstrates: 'Nested container rename: `coords.lat/lng` becomes `coordinates.latitude/longitude`.',
    expectedDetection: 'One container-level rename (children folded in). The declarative adapter cannot rename across parents in one step, so the proposal is flagged for manual review.',
    mappings: [{ feature: 'Store locator map', jsonPath: '$.coords.lat', route: '/stores', impactLevel: 'High' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      const base = { place_id: 'plc_77', city: 'Pune', country: 'IN', accuracy_m: 12 };
      res.json(drifted ? { ...base, coordinates: { latitude: 18.5204, longitude: 73.8567 } } : { ...base, coords: { lat: 18.5204, lng: 73.8567 } });
    },
  },
  {
    key: 'orders-recent',
    mode: 'drifts',
    name: 'Orders & Fulfillment API',
    method: 'GET',
    path: '/orders/recent',
    failureType: 'pagination',
    demonstrates: 'Pagination model change: page-number envelope `{data, page}` becomes cursor-based `{items, cursor}`.',
    expectedDetection: 'Incident with `data -> items` rename and removed `page.*` fields; order-history mapping affected; proposal needs manual review for the removed page fields.',
    mappings: [{ feature: 'Order history table', jsonPath: '$.data[].order_id', route: '/orders', impactLevel: 'Critical' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      const rows = [
        { order_id: 'ord_501', total: 129.0, currency: 'USD', status: 'paid' },
        { order_id: 'ord_502', total: 59.5, currency: 'USD', status: 'shipped' },
        { order_id: 'ord_503', total: 240.0, currency: 'EUR', status: 'paid' },
      ];
      res.json(drifted ? { items: rows, cursor: { next: 'eyJvIjoib3JkXzUwMyJ9', has_more: true } } : { data: rows, page: { number: 1, size: 3, total: 42 } });
    },
  },
  {
    key: 'inventory-stock',
    mode: 'drifts',
    name: 'Catalog Inventory API',
    method: 'GET',
    path: '/inventory/stock',
    failureType: 'type_change',
    demonstrates: 'Type change inside array items: `quantity` and `price` become strings ("12", "19.99").',
    expectedDetection: 'Incident "type changed" for `items[].quantity` and `items[].price`; adapter proposal with two lossless coerce operations; validation passes.',
    mappings: [{ feature: 'Stock badge', jsonPath: '$.items[].quantity', route: '/products', impactLevel: 'High' }],
    autoRepairable: true,
    handle: (drifted, _req, res) => {
      const items = [
        { sku: 'PRO-102', quantity: 12, price: 19.99, warehouse: 'BLR-1' },
        { sku: 'PRO-311', quantity: 0, price: 5.5, warehouse: 'BLR-1' },
        { sku: 'PRO-418', quantity: 87, price: 120, warehouse: 'PNQ-2' },
      ];
      res.json({ generated_at: now(), items: drifted ? items.map((i) => ({ ...i, quantity: String(i.quantity), price: String(i.price) })) : items });
    },
  },
  {
    key: 'catalog-products',
    mode: 'drifts',
    name: 'Product Catalog API',
    method: 'GET',
    path: '/catalog/products',
    failureType: 'field_removed',
    demonstrates: 'Fields disappear with no replacement: `currency` and `dimensions.weight_kg` are dropped from every product.',
    expectedDetection: 'Incident "field removed"; price-display mapping affected; proposal requires manual review because nothing can be mapped back.',
    mappings: [{ feature: 'Price display', jsonPath: '$.products[].currency', route: '/catalog', impactLevel: 'Critical' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      const products = [
        { id: 'p_1', title: 'Desk lamp', price: 39.9, currency: 'USD', dimensions: { width_cm: 12, height_cm: 40, weight_kg: 1.2 } },
        { id: 'p_2', title: 'Chair', price: 149.0, currency: 'USD', dimensions: { width_cm: 55, height_cm: 90, weight_kg: 7.5 } },
      ];
      res.json({ products: drifted ? products.map(({ currency: _c, dimensions: { weight_kg: _w, ...dims }, ...p }) => ({ ...p, dimensions: dims })) : products });
    },
  },
  {
    key: 'wallet-balance',
    mode: 'drifts',
    name: 'Wallet Balance API',
    method: 'GET',
    path: '/wallet/balance',
    failureType: 'mixed',
    demonstrates: 'Mixed drift: `balance` becomes null, `currency` is removed and `balance_cents` appears.',
    expectedDetection: 'Null is nullable (no type change); `currency` removed and `balance_cents` added are not paired (incompatible meaning); proposal flagged for manual review.',
    mappings: [{ feature: 'Wallet widget', jsonPath: '$.balance', route: '/wallet', impactLevel: 'High' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      res.json(drifted ? { account_id: 'acc_9', balance: null, balance_cents: 1250000, last_txn_at: now() } : { account_id: 'acc_9', balance: 12500.0, currency: 'INR', last_txn_at: now() });
    },
  },
  {
    key: 'weather-current',
    mode: 'drifts',
    name: 'Weather API',
    method: 'GET',
    path: '/weather/current',
    failureType: 'value_change',
    demonstrates: 'Honest negative case: only values and an additive field change (`unit` C -> F, new `feels_like`). Structure is intact.',
    expectedDetection: 'No incident. The check records value changes and one added field as non-breaking; the dashboard shows "Changes detected" without an alert.',
    mappings: [{ feature: 'Weather tile', jsonPath: '$.temperature', route: '/home', impactLevel: 'Low' }],
    autoRepairable: true,
    handle: (drifted, _req, res) => {
      res.json(drifted ? { city: 'Pune', temperature: 84.2, unit: 'F', humidity: 61, feels_like: 88.1, observed_at: now() } : { city: 'Pune', temperature: 29.0, unit: 'C', humidity: 61, observed_at: now() });
    },
  },
  {
    key: 'auth-session',
    mode: 'drifts',
    name: 'Authentication SSO Service',
    method: 'GET',
    path: '/auth/session',
    failureType: 'http_error',
    demonstrates: 'Availability failure: the endpoint starts returning HTTP 503 with an error body.',
    expectedDetection: 'Critical "HTTP error" incident, monitor shows Failing, every mapping listed as affected, no adapter proposal (a transform cannot fix an outage); auto-resolves after restore.',
    mappings: [{ feature: 'Login page', jsonPath: '$.session_id', route: '/login', impactLevel: 'Critical' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      if (drifted) {
        res.status(503).json({ error: 'Service Unavailable', code: 503, message: 'identity provider connection pool exhausted' });
        return;
      }
      res.json({ session_id: 'sess_a1b2', user_id: 'u_104', expires_in: 3600, mfa: true });
    },
  },
  {
    key: 'notifications-status',
    mode: 'drifts',
    name: 'Notification Dispatch API',
    method: 'GET',
    path: '/notifications/status',
    failureType: 'timeout',
    demonstrates: 'Latency failure: responses take longer than the monitor timeout (default 5s).',
    expectedDetection: 'Critical "Timeout" incident with a null HTTP status; resolves when the endpoint is fast again.',
    mappings: [{ feature: 'Order confirmation email', jsonPath: '$.queue_depth', route: '/checkout', impactLevel: 'Medium' }],
    autoRepairable: false,
    handle: (drifted, req, res, store) => {
      const body = { queue_depth: 4, workers: 8, oldest_message_age_s: 2 };
      if (!drifted) {
        res.json(body);
        return;
      }
      const timer = setTimeout(() => {
        if (!res.headersSent) res.json(body);
      }, store.slowMs);
      req.on('close', () => clearTimeout(timer));
    },
  },
  {
    key: 'search-suggest',
    mode: 'drifts',
    name: 'Search Suggestions API',
    method: 'GET',
    path: '/search/suggest',
    failureType: 'rate_limit',
    demonstrates: 'Rate limiting: HTTP 429 with a Retry-After header.',
    expectedDetection: 'High-severity "HTTP error" incident (rate limited); monitor Failing; auto-resolves after restore.',
    mappings: [{ feature: 'Search box autocomplete', jsonPath: '$.suggestions[].term', route: '/search', impactLevel: 'Medium' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      if (drifted) {
        res.setHeader('Retry-After', '30');
        res.status(429).json({ error: 'rate_limited', message: 'quota exceeded for api key' });
        return;
      }
      res.json({ query: 'des', suggestions: [{ term: 'desk', score: 0.9 }, { term: 'desk lamp', score: 0.7 }] });
    },
  },
  {
    key: 'feed-latest',
    mode: 'drifts',
    name: 'Content Feed API',
    method: 'GET',
    path: '/feed/latest',
    failureType: 'malformed',
    demonstrates: 'Malformed response: declares JSON but returns a truncated document.',
    expectedDetection: '"HTTP error" incident classified as a malformed response; no structural diff is attempted on unparsable bodies.',
    mappings: [{ feature: 'Home feed', jsonPath: '$.posts[].id', route: '/home', impactLevel: 'High' }],
    autoRepairable: false,
    handle: (drifted, _req, res) => {
      if (drifted) {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send('{"posts":[{"id":"po_1","title":"Hello"},{"id":"po_2",');
        return;
      }
      res.json({ posts: [{ id: 'po_1', title: 'Hello' }, { id: 'po_2', title: 'World' }], next: null });
    },
  },
  // --- always correct: baselines lock and stay green --------------------------------
  {
    key: 'health-ping',
    name: 'Health Ping API',
    method: 'GET',
    path: '/health/ping',
    mode: 'healthy',
    failureType: 'value_change',
    demonstrates: 'Always correct. A tiny status document whose only changing values are volatile (uptime, timestamp).',
    expectedDetection: 'Baseline locks on the first check and the monitor stays Healthy; no incidents ever.',
    mappings: [{ feature: 'Status page', jsonPath: '$.status', route: '/status', impactLevel: 'Low' }],
    autoRepairable: true,
    handle: (_d, _req, res) => {
      res.json({ status: 'ok', version: '2.4.1', uptime_s: Math.round(process.uptime()), timestamp: now() });
    },
  },
  {
    key: 'products-featured',
    name: 'Featured Products API',
    method: 'GET',
    path: '/products/featured',
    mode: 'healthy',
    failureType: 'value_change',
    demonstrates: 'Always correct. A stable list payload with nested objects and arrays.',
    expectedDetection: 'Baseline with nested array shape; stays Healthy. Good control case next to the failing APIs.',
    mappings: [{ feature: 'Home carousel', jsonPath: '$.products[].title', route: '/home', impactLevel: 'Medium' }],
    autoRepairable: true,
    handle: (_d, _req, res) => {
      res.json({ products: [{ id: 'p_1', title: 'Desk lamp', price: { amount: 39.9, currency: 'USD' }, tags: ['home', 'light'] }, { id: 'p_2', title: 'Chair', price: { amount: 149, currency: 'USD' }, tags: ['home'] }], total: 2 });
    },
  },
  {
    key: 'rates-fx',
    name: 'FX Rates API',
    method: 'GET',
    path: '/rates/fx',
    mode: 'healthy',
    failureType: 'value_change',
    demonstrates: 'Always correct, but every value changes on each call (live rates).',
    expectedDetection: 'Structure identical on every check, so no incident even though values differ; the "Changes detected" counter grows harmlessly.',
    mappings: [{ feature: 'Currency converter', jsonPath: '$.rates.EUR', route: '/convert', impactLevel: 'Medium' }],
    autoRepairable: true,
    handle: (_d, _req, res) => {
      const t = Date.now() / 1000;
      res.json({ base: 'USD', as_of: now(), rates: { EUR: Number((0.91 + Math.sin(t) * 0.01).toFixed(4)), INR: Number((83.1 + Math.cos(t) * 0.3).toFixed(2)), GBP: Number((0.78 + Math.sin(t / 2) * 0.01).toFixed(4)) } });
    },
  },
  {
    key: 'echo',
    name: 'Echo API (POST)',
    method: 'POST',
    path: '/echo',
    mode: 'healthy',
    failureType: 'value_change',
    demonstrates: 'Always correct POST endpoint: returns the request body wrapped in an envelope. Use it to test monitors with a JSON body.',
    expectedDetection: 'Baseline follows whatever body you send; stays Healthy while you keep the same body shape.',
    mappings: [{ feature: 'Form submit', jsonPath: '$.received', route: '/form', impactLevel: 'Low' }],
    autoRepairable: true,
    requestBody: { order_id: 'ord_1', items: 2 },
    handle: (_d, req, res) => {
      res.status(201).json({ received: (req.body as unknown) ?? null, received_at: now(), request_id: `req_${Math.random().toString(36).slice(2, 8)}` });
    },
  },
  // --- always broken: never produce a baseline ---------------------------------------
  {
    key: 'legacy-export',
    name: 'Legacy Export API',
    method: 'GET',
    path: '/legacy/export',
    mode: 'broken',
    failureType: 'http_error',
    demonstrates: 'Always HTTP 500 with an error body.',
    expectedDetection: 'No baseline can be captured; every check opens/updates one Critical "HTTP error" incident; monitor stays Failing.',
    mappings: [{ feature: 'Monthly export job', jsonPath: '$.job_id', route: '/exports', impactLevel: 'High' }],
    autoRepairable: false,
    handle: (_d, _req, res) => {
      res.status(500).json({ error: 'Internal Server Error', message: 'legacy exporter crashed: NullPointerException at ExportJob.run' });
    },
  },
  {
    key: 'reports-slow',
    name: 'Reports API (slow)',
    method: 'GET',
    path: '/reports/slow',
    mode: 'broken',
    failureType: 'timeout',
    demonstrates: 'Always slower than a 5-second timeout.',
    expectedDetection: 'Timeout incident on every check (status null); try a 10-second monitor timeout to see it pass instead.',
    mappings: [{ feature: 'Finance dashboard', jsonPath: '$.rows[].total', route: '/finance', impactLevel: 'Medium' }],
    autoRepairable: false,
    handle: (_d, req, res, store) => {
      const timer = setTimeout(() => {
        if (!res.headersSent) res.json({ rows: [{ month: '2026-09', total: 12000 }, { month: '2026-10', total: 13500 }], generated_at: now() });
      }, store.slowMs);
      req.on('close', () => clearTimeout(timer));
    },
  },
  {
    key: 'status-html',
    name: 'Status Page (HTML)',
    method: 'GET',
    path: '/status/html',
    mode: 'broken',
    failureType: 'malformed',
    demonstrates: 'Returns HTML instead of JSON (a typical login or maintenance page in front of an API).',
    expectedDetection: 'Healthy HTTP 200 but non-JSON: status and latency are monitored, no structural baseline (row shows "status-only").',
    mappings: [],
    autoRepairable: false,
    handle: (_d, _req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send('<!doctype html><html><head><title>Maintenance</title></head><body><h1>We will be back shortly</h1></body></html>');
    },
  },
  {
    key: 'retired',
    name: 'Retired Endpoint',
    method: 'GET',
    path: '/v1/retired',
    mode: 'broken',
    failureType: 'http_error',
    demonstrates: 'Always HTTP 404: the provider removed the endpoint.',
    expectedDetection: 'Critical "HTTP error" incident, monitor Failing, no adapter possible.',
    mappings: [{ feature: 'Legacy widget', jsonPath: '$.data', route: '/legacy', impactLevel: 'Low' }],
    autoRepairable: false,
    handle: (_d, _req, res) => {
      res.status(404).json({ error: 'not_found', message: 'this endpoint was retired in v2' });
    },
  },
  // --- flaky: alternates between healthy and failing ---------------------------------
  {
    key: 'flaky-gateway',
    name: 'Flaky Gateway API',
    method: 'GET',
    path: '/gateway/flaky',
    mode: 'flaky',
    failureType: 'http_error',
    demonstrates: 'Every other call fails with HTTP 502; the rest are correct.',
    expectedDetection: 'Baseline locks on a good call; incidents open on 502 and auto-resolve on the next good call, so the timeline flaps and uptime stays around 50%.',
    mappings: [{ feature: 'Checkout gateway', jsonPath: '$.gateway', route: '/checkout', impactLevel: 'Critical' }],
    autoRepairable: false,
    handle: (_d, req, res) => {
      const call = Number(res.getHeader('X-Demo-Call') ?? 1);
      if (call % 2 === 0) {
        res.status(502).json({ error: 'bad_gateway', message: 'upstream reset the connection' });
        return;
      }
      res.json({ gateway: 'gw-eu-1', healthy: true, latency_budget_ms: 250, checked_at: now(), path: req.path });
    },
  },
];

export const DEMO_CATALOG: DemoEndpoint[] = CATALOG_IMPL.map(({ handle: _h, ...e }) => e);

export function findDemoEndpoint(key: string): DemoEndpoint | undefined {
  return DEMO_CATALOG.find((e) => e.key === key);
}

export function createDemoMockRouter(store: DemoStore): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({ driftAfterMs: store.driftAfterMs, endpoints: DEMO_CATALOG.map((e) => ({ ...e, state: store.state(e.key) })) });
  });
  for (const e of CATALOG_IMPL) {
    const method = e.method === 'POST' ? 'post' : 'get';
    router[method](e.path, (req, res) => {
      const { drifted, calls } = store.hit(e.key);
      res.setHeader('X-Demo-Call', String(calls));
      res.setHeader('X-Demo-Drifted', String(e.mode === 'drifts' ? drifted : e.mode === 'broken'));
      res.setHeader('X-Demo-Mode', e.mode);
      e.handle(e.mode === 'drifts' ? drifted : e.mode === 'broken', req, res, store);
    });
  }
  return router;
}
