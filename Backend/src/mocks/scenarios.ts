import { z } from 'zod';
import { PROVIDER_KEYS, providerKeySchema, type ProviderKey } from '../providers/contracts.js';

/**
 * Deterministic fault/behaviour scenarios the mock providers can be put in.
 * One scenario is active per provider at a time; `baseline` is the default.
 */
export const SCENARIOS = [
  'baseline',
  /** Payments: `transaction_id` renamed to `payment_reference`, still HTTP 200. */
  'schema_rename',
  /** Shipping: `delivery_status` is `in_transit` instead of `shipped`, still HTTP 200. */
  'semantic_change',
  /** Hold the response longer than any sane client timeout. */
  'timeout',
  /** Destroy the socket without responding. */
  'connection_reset',
  'http_500',
  'http_503',
  /** HTTP 429, optionally with Retry-After. */
  'rate_limited',
  /** Payments: HTTP 200 with a negative amount. */
  'unsafe_data',
  /** Drop a required field from the response. */
  'missing_field',
  /** Add an unexpected field to the response. */
  'added_field',
  /** Return a required field with the wrong JSON type. */
  'wrong_type',
  /** HTTP 200 with a body that is not valid JSON. */
  'malformed_json',
  /** Delay the response by `delayMs` (default 1500) but answer correctly. */
  'slow_response',
  /** HTTP 200 with a body of roughly `sizeBytes` (default 2 MiB). */
  'oversized_response',
] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const scenarioSchema = z.enum(SCENARIOS);

/** Scenarios that only make sense for one provider. */
export const SCENARIO_PROVIDERS: Partial<Record<Scenario, readonly ProviderKey[]>> = {
  schema_rename: ['payments'],
  unsafe_data: ['payments'],
  semantic_change: ['shipping'],
};

export const scenarioOptionsSchema = z
  .object({
    /** Delay before responding (slow_response, timeout). */
    delayMs: z.number().int().min(0).max(120_000).optional(),
    /** Retry-After seconds (rate_limited). Omit to send no header. */
    retryAfterSeconds: z.number().int().min(0).max(3_600).optional(),
    /** Approximate body size (oversized_response). */
    sizeBytes: z.number().int().min(1_024).max(50 * 1_024 * 1_024).optional(),
    /** Which field to drop / mistype / add (missing_field, wrong_type, added_field). */
    field: z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    /** Restrict the scenario to one endpoint key, e.g. `POST /charges`. Omit for all. */
    endpoint: z.string().min(1).max(256).optional(),
  })
  .strict();
export type ScenarioOptions = z.infer<typeof scenarioOptionsSchema>;

export const activateScenarioSchema = z
  .object({ scenario: scenarioSchema, options: scenarioOptionsSchema.default({}) })
  .strict();

export interface ActiveScenario {
  provider: ProviderKey;
  scenario: Scenario;
  options: ScenarioOptions;
  activatedAt: string;
}

export class ScenarioNotApplicableError extends Error {
  constructor(
    public readonly scenario: Scenario,
    public readonly provider: ProviderKey,
  ) {
    super(`scenario "${scenario}" is not applicable to provider "${provider}"`);
    this.name = 'ScenarioNotApplicableError';
  }
}

/**
 * In-memory, per-process scenario state. Deterministic: activation replaces
 * the previous scenario, reset returns to baseline. Not shared across
 * processes by design (demo/test tooling, not a production feature).
 */
export class ScenarioStore {
  private readonly active = new Map<ProviderKey, ActiveScenario>();

  activate(provider: ProviderKey, scenario: Scenario, options: ScenarioOptions = {}, now: Date = new Date()): ActiveScenario {
    const allowed = SCENARIO_PROVIDERS[scenario];
    if (allowed && !allowed.includes(provider)) throw new ScenarioNotApplicableError(scenario, provider);
    const entry: ActiveScenario = { provider, scenario, options, activatedAt: now.toISOString() };
    if (scenario === 'baseline') this.active.delete(provider);
    else this.active.set(provider, entry);
    return entry;
  }

  get(provider: ProviderKey): ActiveScenario {
    return this.active.get(provider) ?? { provider, scenario: 'baseline', options: {}, activatedAt: '' };
  }

  /** Scenario in effect for a given provider endpoint (honours `options.endpoint`). */
  forEndpoint(provider: ProviderKey, endpointKey: string): ActiveScenario {
    const entry = this.get(provider);
    if (entry.options.endpoint && entry.options.endpoint !== endpointKey) {
      return { provider, scenario: 'baseline', options: {}, activatedAt: '' };
    }
    return entry;
  }

  reset(provider?: ProviderKey): void {
    if (provider) this.active.delete(provider);
    else this.active.clear();
  }

  snapshot(): ActiveScenario[] {
    return PROVIDER_KEYS.map((p) => this.get(p));
  }
}

export { providerKeySchema };
