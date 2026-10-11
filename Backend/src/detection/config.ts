import { z } from 'zod';

/**
 * Detection thresholds. Snapshotted into every baseline so a finding can
 * always be explained by the exact configuration that produced it.
 * Defaults are deliberately conservative to limit false positives.
 */
export const detectionConfigSchema = z
  .object({
    /** Observations required before a baseline may be created. */
    minSamplesForBaseline: z.number().int().min(1).max(10_000).default(5),
    /**
     * Field paths (or glob-ish patterns: `*` matches any run of characters)
     * whose VALUES are volatile and therefore ignored for value statistics.
     * Presence and type are still tracked.
     */
    volatileFields: z
      .array(z.string().min(1).max(256))
      .max(200)
      .default(['id', '*_id', '*.id', '*_at', '*.*_at', 'created', 'updated', 'timestamp', 'date', 'etag', 'request_id', 'padding']),
    /** A field present in at least this share of baseline samples is "required". */
    requiredPresenceRatio: z.number().min(0.5).max(1).default(0.95),
    /** Value distributions are tracked only for fields with at most this many distinct values... */
    enumMaxCardinality: z.number().int().min(2).max(50).default(10),
    /** ...and at least this many sampled values. */
    enumMinSamples: z.number().int().min(2).max(10_000).default(10),
    /** Name similarity (0..1) above which a removed/added pair is a rename candidate. */
    renameSimilarityThreshold: z.number().min(0).max(1).default(0.5),
    /** Rolling window of recent observations for statistical rules. */
    window: z
      .object({
        size: z.number().int().min(2).max(500).default(20),
        /** Statistical rules stay silent below this many observations in the window. */
        minSamples: z.number().int().min(2).max(500).default(10),
      })
      .default({ size: 20, minSamples: 10 }),
    latency: z
      .object({
        /** Window p95 must exceed baseline p95 by this factor... */
        p95Factor: z.number().min(1).max(100).default(2),
        /** ...and by at least this many milliseconds. */
        minDeltaMs: z.number().min(0).max(600_000).default(100),
      })
      .default({ p95Factor: 2, minDeltaMs: 100 }),
    /** Applies to error, timeout, unavailable and rate-limit rates alike. */
    rates: z
      .object({
        /** Window rate must exceed baseline rate by at least this absolute amount (0..1). */
        minIncrease: z.number().min(0).max(1).default(0.2),
        /** ...and the window must contain at least this many affected observations. */
        minCount: z.number().int().min(1).max(500).default(3),
      })
      .default({ minIncrease: 0.2, minCount: 3 }),
  })
  .strict();

export type DetectionConfig = z.infer<typeof detectionConfigSchema>;
export const DEFAULT_DETECTION_CONFIG: DetectionConfig = detectionConfigSchema.parse({});

/** Partial overrides accepted from the API when creating a baseline. */
export const detectionConfigInputSchema = detectionConfigSchema.partial().extend({
  window: detectionConfigSchema.shape.window.unwrap().partial().optional(),
  latency: detectionConfigSchema.shape.latency.unwrap().partial().optional(),
  rates: detectionConfigSchema.shape.rates.unwrap().partial().optional(),
}).strict();
export type DetectionConfigInput = z.infer<typeof detectionConfigInputSchema>;

export function resolveDetectionConfig(input: DetectionConfigInput | undefined): DetectionConfig {
  const d = DEFAULT_DETECTION_CONFIG;
  return detectionConfigSchema.parse({
    ...d,
    ...input,
    window: { ...d.window, ...input?.window },
    latency: { ...d.latency, ...input?.latency },
    rates: { ...d.rates, ...input?.rates },
  });
}

/** Match a field path against a volatile pattern (`*` = any run of characters). */
export function matchesPattern(path: string, pattern: string): boolean {
  if (!pattern.includes('*')) return path === pattern;
  const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
  return re.test(path);
}

export function isVolatile(path: string, config: DetectionConfig): boolean {
  // Strip array markers so `data[].created_at` matches `*_at`.
  const plain = path.replace(/\[\]/g, '');
  const leaf = plain.split('.').pop() ?? plain;
  return config.volatileFields.some((p) => matchesPattern(plain, p) || matchesPattern(leaf, p));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
