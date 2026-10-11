import type { StoredObservation } from '../observation/store.js';
import type { JsonType } from '../observation/schemas.js';
import { isVolatile, type DetectionConfig } from './config.js';

/**
 * Canonical view of one observation for comparison. Key order is irrelevant
 * (paths are sorted), array elements are merged under `path[]`, and values
 * of volatile fields are dropped. Nothing here interprets meaning.
 */
export interface NormalizedField {
  /** Non-null JSON types seen for this path. */
  types: JsonType[];
  /** True when at least one null was observed at this path. */
  nullable: boolean;
}

export type ScalarValue = string | number | boolean;

export interface NormalizedObservation {
  id: string;
  observedAt: Date;
  statusCode: number | null;
  outcome: StoredObservation['outcome'];
  errorCategory: StoredObservation['errorCategory'];
  latencyMs: number;
  /** Present only when the body parsed as JSON. */
  fields: Map<string, NormalizedField> | null;
  /** Scalar values per non-volatile path (bounded by the stored sample). */
  values: Map<string, ScalarValue[]>;
  shapeHash: string | null;
}

/** Scalar value strings longer than this are not tracked as enum candidates. */
const MAX_TRACKED_VALUE_LENGTH = 64;

export function normalizeObservation(obs: StoredObservation, config: DetectionConfig): NormalizedObservation {
  let fields: Map<string, NormalizedField> | null = null;
  if (obs.parseOutcome === 'JSON' && obs.fieldPaths) {
    fields = new Map();
    for (const fp of obs.fieldPaths) {
      const entry = fields.get(fp.path) ?? { types: [], nullable: false };
      if (fp.type === 'null') entry.nullable = true;
      else if (!entry.types.includes(fp.type)) entry.types.push(fp.type);
      fields.set(fp.path, entry);
    }
    for (const entry of fields.values()) entry.types.sort();
    fields = new Map([...fields.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  const values = new Map<string, ScalarValue[]>();
  if (obs.parseOutcome === 'JSON' && obs.responseSample !== null && obs.responseSample !== undefined) {
    collectValues(obs.responseSample, '', values, 0);
    for (const path of [...values.keys()]) {
      if (isVolatile(path, config)) values.delete(path);
    }
  }

  return {
    id: obs.id,
    observedAt: obs.observedAt,
    statusCode: obs.statusCode,
    outcome: obs.outcome,
    errorCategory: obs.errorCategory,
    latencyMs: obs.latencyMs,
    fields,
    values: new Map([...values.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    shapeHash: obs.shapeHash,
  };
}

function collectValues(value: unknown, path: string, out: Map<string, ScalarValue[]>, depth: number): void {
  if (depth > 8) return;
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      // Skip the truncation markers the sampler appends.
      if (typeof item === 'string' && item.startsWith('…[+')) continue;
      collectValues(item, `${path}[]`, out, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      if (key.startsWith('__')) continue;
      collectValues((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key, out, depth + 1);
    }
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_TRACKED_VALUE_LENGTH || value === '[REDACTED]') return;
  } else if (typeof value !== 'number' && typeof value !== 'boolean') {
    return;
  }
  const list = out.get(path) ?? [];
  list.push(value);
  out.set(path, list);
}
