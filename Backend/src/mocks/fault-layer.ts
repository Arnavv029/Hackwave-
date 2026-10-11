import type { Request, Response } from 'express';
import type { ProviderKey } from '../providers/contracts.js';
import type { ActiveScenario, Scenario, ScenarioStore } from './scenarios.js';

/**
 * Applies the active scenario to a baseline response. Provider routers build
 * the correct body and hand it here; this layer decides whether to send it,
 * corrupt it, delay it, or fail the request.
 */

export interface RespondOptions {
  provider: ProviderKey;
  /** `POST /charges` — used to scope scenarios to one endpoint. */
  endpointKey: string;
  status?: number;
  body: Record<string, unknown>;
  /** Field targeted by missing_field / wrong_type / added_field when no option is given. */
  defaultField: string;
  /** Provider-specific transformations (schema_rename, semantic_change, unsafe_data). */
  applyProviderScenario?: (scenario: Scenario, body: Record<string, unknown>) => Record<string, unknown>;
}

const DEFAULT_TIMEOUT_HOLD_MS = 30_000;
const DEFAULT_SLOW_MS = 1_500;
const DEFAULT_OVERSIZE_BYTES = 2 * 1_024 * 1_024;

export function respondWithScenario(store: ScenarioStore, req: Request, res: Response, opts: RespondOptions): void {
  const active = store.forEndpoint(opts.provider, opts.endpointKey);
  const { scenario, options } = active;
  setCommonHeaders(res, opts.provider, active, req);

  switch (scenario) {
    case 'connection_reset':
      res.socket?.destroy();
      return;
    case 'timeout':
      hold(req, res, options.delayMs ?? DEFAULT_TIMEOUT_HOLD_MS, () => sendJson(res, opts.status ?? 200, opts.body));
      return;
    case 'slow_response':
      hold(req, res, options.delayMs ?? DEFAULT_SLOW_MS, () => sendJson(res, opts.status ?? 200, opts.body));
      return;
    case 'http_500':
      sendJson(res, 500, { error: { code: 'internal_error', message: 'simulated upstream failure' } });
      return;
    case 'http_503':
      res.setHeader('retry-after', String(options.retryAfterSeconds ?? 5));
      sendJson(res, 503, { error: { code: 'service_unavailable', message: 'simulated maintenance' } });
      return;
    case 'rate_limited':
      if (options.retryAfterSeconds !== undefined) res.setHeader('retry-after', String(options.retryAfterSeconds));
      res.setHeader('x-ratelimit-limit', '100');
      res.setHeader('x-ratelimit-remaining', '0');
      sendJson(res, 429, { error: { code: 'rate_limited', message: 'too many requests' } });
      return;
    case 'malformed_json':
      res.status(opts.status ?? 200);
      res.setHeader('content-type', 'application/json; charset=utf-8');
      // Truncated JSON: valid prefix, no closing brace.
      res.send(JSON.stringify(opts.body).slice(0, -1).concat(',"trailing":'));
      return;
    case 'oversized_response': {
      const size = options.sizeBytes ?? DEFAULT_OVERSIZE_BYTES;
      sendJson(res, opts.status ?? 200, { ...opts.body, padding: 'x'.repeat(size) });
      return;
    }
    case 'missing_field':
      sendJson(res, opts.status ?? 200, mapRecords(opts.body, (r) => omit(r, options.field ?? opts.defaultField)));
      return;
    case 'added_field':
      sendJson(
        res,
        opts.status ?? 200,
        mapRecords(opts.body, (r) => ({ ...r, [options.field ?? 'experimental_flag']: true })),
      );
      return;
    case 'wrong_type':
      sendJson(
        res,
        opts.status ?? 200,
        mapRecords(opts.body, (r) => {
          const field = options.field ?? opts.defaultField;
          if (!(field in r)) return r;
          const v = r[field];
          return { ...r, [field]: typeof v === 'string' ? 12345 : String(v) };
        }),
      );
      return;
    case 'schema_rename':
    case 'semantic_change':
    case 'unsafe_data': {
      const body = opts.applyProviderScenario ? opts.applyProviderScenario(scenario, opts.body) : opts.body;
      sendJson(res, opts.status ?? 200, body);
      return;
    }
    case 'baseline':
      sendJson(res, opts.status ?? 200, opts.body);
      return;
    default: {
      const exhaustive: never = scenario;
      throw new Error(`unhandled scenario ${String(exhaustive)}`);
    }
  }
}

function setCommonHeaders(res: Response, provider: ProviderKey, active: ActiveScenario, req: Request): void {
  res.setHeader('x-mock-provider', provider);
  res.setHeader('x-mock-scenario', active.scenario);
  res.setHeader('x-request-id', typeof req.id === 'string' ? req.id : 'mock');
  // Deliberately emits session material so redaction can be verified end to end.
  res.setHeader('set-cookie', `mock_session=${provider}-session-secret; HttpOnly`);
}

function sendJson(res: Response, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return;
  res.status(status).json(body);
}

/** Delay a response but stop the timer if the client gives up first. */
function hold(req: Request, res: Response, ms: number, send: () => void): void {
  const timer = setTimeout(() => {
    if (!res.destroyed) send();
  }, ms);
  timer.unref();
  req.on('close', () => clearTimeout(timer));
}

/** Apply `fn` to the record itself, or to each item of a `data` array for list responses. */
function mapRecords(
  body: Record<string, unknown>,
  fn: (r: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const data: unknown = body['data'];
  if (Array.isArray(data)) {
    return { ...body, data: (data as unknown[]).map((item) => (isRecord(item) ? fn(item) : item)) };
  }
  return fn(body);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function omit(r: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r).filter(([k]) => k !== key));
}

export { mapRecords };
