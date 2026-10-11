import { z } from 'zod';

/**
 * Environment schema. Everything the process needs from the outside world is
 * declared here, validated once at startup, and exposed as a typed object.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  SERVICE_NAME: z.string().min(1).default('driftguard-api'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a postgresql:// connection string',
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  TEST_DATABASE_URL: z
    .string()
    .refine((v) => v === '' || v.startsWith('postgresql://') || v.startsWith('postgres://'), {
      message: 'TEST_DATABASE_URL must be a postgresql:// connection string',
    })
    .optional(),

  // Phase 2: mock providers and observation engine.
  /** Mount the mock Payments/Shipping providers under /mock. Defaults to on outside production. */
  MOCK_PROVIDERS_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /**
   * Bearer token required by the scenario-control endpoints. Controls are
   * never mounted in production, and never mounted when this is unset.
   */
  SCENARIO_CONTROL_TOKEN: z.string().min(16).optional(),
  /** Base URL the observation engine uses to reach the mock providers (defaults to this server). */
  MOCK_PROVIDERS_BASE_URL: z.string().url().optional(),
  /**
   * Phase 3: bearer token for baseline review/promotion and finding status
   * changes. When unset, those endpoints are open (development only).
   */
  OPERATOR_TOKEN: z.string().min(16).optional(),
  // Phase 6: AI-assisted proposals.
  /** `disabled` (default), `anthropic`, or `mock` (tests / demos without a key). */
  AI_PROVIDER: z.enum(['disabled', 'anthropic', 'mock']).default('disabled'),
  /** Read by the Anthropic SDK; never logged. Optional because the SDK can also use an `ant auth login` profile. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(10),
  AI_MAX_CONCURRENT: z.coerce.number().int().min(1).max(20).default(2),
  AI_MAX_REPORT_BYTES: z.coerce.number().int().min(4_096).max(262_144).default(32_768),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1_024).max(64_000).default(16_000),
  // Phase 9: URL monitors (API Guardian workflow).
  /** Passphrase for AES-256-GCM encryption of monitor credentials (min 16 chars). Unset = credentials cannot be stored. */
  MONITOR_SECRET_KEY: z.string().min(16).optional(),
  /** Run the in-process scheduler (default: on). Turn off for one-off tooling. */
  MONITOR_SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Hard cap for the SSRF guard: when false, private destinations are always refused. Defaults to true outside production. */
  MONITOR_ALLOW_PRIVATE_NETWORKS: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  MONITOR_SCHEDULER_TICK_MS: z.coerce.number().int().min(200).max(60_000).default(1_000),
  MONITOR_MAX_CONCURRENT_CHECKS: z.coerce.number().int().min(1).max(50).default(4),
  /** Per-request timeout for provider calls. */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  /** Upper bound on bytes read from a provider response body. */
  PROVIDER_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: ReadonlyArray<{ path: string; message: string }>) {
    super(
      `Invalid environment configuration:\n${issues
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse an environment-like record. Throws EnvValidationError listing every
 * problem at once so misconfiguration is fixed in one round trip.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily parsed, process-wide environment. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test helper: drop the cached environment so the next getEnv() re-parses. */
export function resetEnvCache(): void {
  cached = undefined;
}
