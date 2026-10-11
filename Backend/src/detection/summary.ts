import { z } from 'zod';
import { jsonTypeSchema } from '../observation/schemas.js';
import type { StoredObservation } from '../observation/store.js';
import { detectionConfigSchema, type DetectionConfig } from './config.js';
import { normalizeObservation, type NormalizedObservation, type ScalarValue } from './normalize.js';

/**
 * A baseline summary is a statistical description of an endpoint's behaviour
 * over an explicit window of observations. It is built once, validated, and
 * never mutated.
 */

export const fieldStatsSchema = z
  .object({
    /** Share of JSON-bodied samples in which the path appeared (0..1). */
    presence: z.number().min(0).max(1),
    /** Non-null types observed (sorted). */
    types: z.array(jsonTypeSchema),
    /** Share of appearances that were null (0..1). */
    nullRate: z.number().min(0).max(1),
    /** Value distribution when the field looks enum-like; absent otherwise. */
    values: z.record(z.string(), z.number().int().nonnegative()).optional(),
    valueSamples: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FieldStats = z.infer<typeof fieldStatsSchema>;

export const latencyStatsSchema = z
  .object({ count: z.number().int(), mean: z.number(), p50: z.number(), p95: z.number(), p99: z.number(), max: z.number() })
  .strict();
export type LatencyStats = z.infer<typeof latencyStatsSchema>;

export const baselineSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    context: z.object({ providerKey: z.string(), endpointKey: z.string(), method: z.string(), contextKey: z.string() }).strict(),
    sampleCount: z.number().int().nonnegative(),
    /** Samples whose body parsed as JSON and whose status was a 2xx. */
    jsonSuccessCount: z.number().int().nonnegative(),
    window: z.object({ from: z.string(), to: z.string(), firstObservationId: z.string(), lastObservationId: z.string() }).strict(),
    fields: z.record(z.string(), fieldStatsSchema),
    statusCodes: z.record(z.string(), z.number().int().nonnegative()),
    outcomes: z.record(z.string(), z.number().int().nonnegative()),
    rates: z
      .object({ error: z.number(), timeout: z.number(), unavailable: z.number(), rateLimited: z.number(), noResponse: z.number() })
      .strict(),
    /** Latency over observations that received an HTTP response. */
    latency: latencyStatsSchema.nullable(),
    shapeHashes: z.record(z.string(), z.number().int().nonnegative()),
    config: detectionConfigSchema,
  })
  .strict();
export type BaselineSummary = z.infer<typeof baselineSummarySchema>;

export class InsufficientSamplesError extends Error {
  constructor(
    public readonly have: number,
    public readonly need: number,
  ) {
    super(`baseline requires at least ${need} observations, found ${have}`);
    this.name = 'InsufficientSamplesError';
  }
}

export interface BuildSummaryInput {
  providerKey: string;
  endpointKey: string;
  method: string;
  contextKey: string;
  observations: StoredObservation[];
  config: DetectionConfig;
}

export function buildBaselineSummary(input: BuildSummaryInput): BaselineSummary {
  const { config } = input;
  const observations = [...input.observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  if (observations.length < config.minSamplesForBaseline) {
    throw new InsufficientSamplesError(observations.length, config.minSamplesForBaseline);
  }
  const normalized = observations.map((o) => normalizeObservation(o, config));
  const first = observations[0] as StoredObservation;
  const last = observations[observations.length - 1] as StoredObservation;

  const statusCodes: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const shapeHashes: Record<string, number> = {};
  const latencies: number[] = [];
  let timeouts = 0;
  let unavailable = 0;
  let rateLimited = 0;
  let noResponse = 0;
  let errors = 0;

  for (const n of normalized) {
    statusCodes[n.statusCode === null ? 'none' : String(n.statusCode)] = (statusCodes[n.statusCode === null ? 'none' : String(n.statusCode)] ?? 0) + 1;
    outcomes[n.outcome] = (outcomes[n.outcome] ?? 0) + 1;
    if (n.shapeHash) shapeHashes[n.shapeHash] = (shapeHashes[n.shapeHash] ?? 0) + 1;
    if (n.statusCode !== null) latencies.push(n.latencyMs);
    else noResponse += 1;
    if (n.outcome === 'TIMEOUT') timeouts += 1;
    if (n.outcome === 'UNAVAILABLE') unavailable += 1;
    if (n.outcome === 'RATE_LIMITED') rateLimited += 1;
    if (n.outcome !== 'SUCCESS') errors += 1;
  }

  const jsonSuccess = normalized.filter((n) => n.fields !== null && n.statusCode !== null && n.statusCode >= 200 && n.statusCode < 300);
  const fields = summarizeFields(jsonSuccess, config);
  const total = normalized.length;

  const summary: BaselineSummary = {
    schemaVersion: 1,
    context: { providerKey: input.providerKey, endpointKey: input.endpointKey, method: input.method, contextKey: input.contextKey },
    sampleCount: total,
    jsonSuccessCount: jsonSuccess.length,
    window: { from: first.observedAt.toISOString(), to: last.observedAt.toISOString(), firstObservationId: first.id, lastObservationId: last.id },
    fields,
    statusCodes,
    outcomes,
    rates: {
      error: errors / total,
      timeout: timeouts / total,
      unavailable: unavailable / total,
      rateLimited: rateLimited / total,
      noResponse: noResponse / total,
    },
    latency: latencies.length ? latencyStats(latencies) : null,
    shapeHashes,
    config,
  };
  return baselineSummarySchema.parse(summary);
}

function summarizeFields(samples: NormalizedObservation[], config: DetectionConfig): Record<string, FieldStats> {
  const out: Record<string, FieldStats> = {};
  if (samples.length === 0) return out;
  const presence = new Map<string, number>();
  const nulls = new Map<string, number>();
  const types = new Map<string, Set<string>>();
  const values = new Map<string, ScalarValue[]>();

  for (const s of samples) {
    for (const [path, f] of s.fields ?? []) {
      presence.set(path, (presence.get(path) ?? 0) + 1);
      if (f.nullable) nulls.set(path, (nulls.get(path) ?? 0) + 1);
      const set = types.get(path) ?? new Set<string>();
      for (const t of f.types) set.add(t);
      types.set(path, set);
    }
    for (const [path, vs] of s.values) {
      const list = values.get(path) ?? [];
      list.push(...vs);
      values.set(path, list);
    }
  }

  for (const [path, count] of [...presence.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const stats: FieldStats = {
      presence: count / samples.length,
      types: [...(types.get(path) ?? [])].sort() as FieldStats['types'],
      nullRate: (nulls.get(path) ?? 0) / count,
    };
    const vs = values.get(path);
    if (vs && vs.length >= config.enumMinSamples) {
      const counts: Record<string, number> = {};
      for (const v of vs) counts[String(v)] = (counts[String(v)] ?? 0) + 1;
      if (Object.keys(counts).length <= config.enumMaxCardinality) {
        stats.values = counts;
        stats.valueSamples = vs.length;
      }
    }
    out[path] = stats;
  }
  return out;
}

export function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { count: sorted.length, mean: round(mean), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] ?? 0 };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
