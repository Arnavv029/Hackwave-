import { createHash } from 'node:crypto';
import { MAX_FIELD_PATHS, type FieldPath, type JsonType, type ShapeDelta } from './schemas.js';
import { redactValue } from '../security/redact.js';

/** JSON type name of a parsed value. */
export function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

/**
 * Flatten a JSON document into `path -> type` entries. Array elements are
 * merged under `path[]` so a list of 500 items yields one shape, not 500.
 * If an array mixes types, each type is recorded once. Output is sorted and
 * capped at MAX_FIELD_PATHS.
 */
export function extractFieldPaths(value: unknown, maxDepth = 8): FieldPath[] {
  const seen = new Map<string, Set<JsonType>>();
  const add = (path: string, type: JsonType): void => {
    let set = seen.get(path);
    if (!set) {
      set = new Set();
      seen.set(path, set);
    }
    set.add(type);
  };
  const visit = (v: unknown, path: string, depth: number): void => {
    if (seen.size >= MAX_FIELD_PATHS * 2) return;
    const type = jsonTypeOf(v);
    if (path) add(path, type);
    if (depth >= maxDepth) return;
    if (type === 'array') {
      for (const item of v as unknown[]) visit(item, `${path}[]`, depth + 1);
    } else if (type === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        visit(child, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  visit(value, '', 0);
  const out: FieldPath[] = [];
  for (const [path, types] of seen) {
    for (const type of types) out.push({ path, type });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.type < b.type ? -1 : 1));
  return out.slice(0, MAX_FIELD_PATHS);
}

/** Stable hash over field paths, independent of key order and array length. */
export function hashFieldPaths(paths: readonly FieldPath[]): string {
  const canonical = paths.map((p) => `${p.path}:${p.type}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Structural difference between a previous and a current shape. This is
 * evidence only: an added optional field and a removed required field both
 * appear here; deciding which is breaking belongs to a later phase.
 */
export function diffFieldPaths(previous: readonly FieldPath[], current: readonly FieldPath[], comparedTo: string): ShapeDelta {
  const prevTypes = groupTypes(previous);
  const currTypes = groupTypes(current);
  const added: string[] = [];
  const removed: string[] = [];
  const typeChanged: ShapeDelta['typeChanged'] = [];
  let unchanged = 0;

  for (const [path, types] of currTypes) {
    const before = prevTypes.get(path);
    if (!before) {
      added.push(path);
    } else if (setEquals(before, types)) {
      unchanged += 1;
    } else {
      typeChanged.push({ path, from: pickType(before), to: pickType(types) });
    }
  }
  for (const path of prevTypes.keys()) {
    if (!currTypes.has(path)) removed.push(path);
  }
  return { comparedTo, added: added.sort(), removed: removed.sort(), typeChanged, unchanged };
}

function groupTypes(paths: readonly FieldPath[]): Map<string, Set<JsonType>> {
  const map = new Map<string, Set<JsonType>>();
  for (const p of paths) {
    const set = map.get(p.path) ?? new Set<JsonType>();
    set.add(p.type);
    map.set(p.path, set);
  }
  return map;
}

function setEquals(a: Set<JsonType>, b: Set<JsonType>): boolean {
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

function pickType(types: Set<JsonType>): JsonType {
  // Prefer the non-null type for readability when a field is nullable.
  for (const t of types) if (t !== 'null') return t;
  return 'null';
}

export interface SampleBounds {
  maxDepth: number;
  maxArrayItems: number;
  maxStringLength: number;
  maxKeys: number;
  maxSerializedBytes: number;
}

export const DEFAULT_SAMPLE_BOUNDS: SampleBounds = {
  maxDepth: 6,
  maxArrayItems: 5,
  maxStringLength: 256,
  maxKeys: 60,
  maxSerializedBytes: 8_192,
};

/**
 * Produce a redacted, size-bounded sample of a JSON document suitable for
 * persistence. Observed values are kept verbatim within the bounds (a
 * negative amount stays negative); only secrets are replaced.
 */
export function boundedSample(value: unknown, bounds: SampleBounds = DEFAULT_SAMPLE_BOUNDS): unknown {
  const bounded = bound(redactValue(value), 0, bounds);
  const serialized = JSON.stringify(bounded);
  if (serialized !== undefined && Buffer.byteLength(serialized) > bounds.maxSerializedBytes) {
    return { __truncated: true, bytes: Buffer.byteLength(serialized), preview: serialized.slice(0, 1_024) };
  }
  return bounded;
}

function bound(value: unknown, depth: number, b: SampleBounds): unknown {
  if (typeof value === 'string') {
    return value.length > b.maxStringLength ? `${value.slice(0, b.maxStringLength)}…[+${value.length - b.maxStringLength}]` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= b.maxDepth) return Array.isArray(value) ? `[array:${value.length}]` : '[object]';
  if (Array.isArray(value)) {
    const items = value.slice(0, b.maxArrayItems).map((v) => bound(v, depth + 1, b));
    if (value.length > b.maxArrayItems) items.push(`…[+${value.length - b.maxArrayItems} items]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries.slice(0, b.maxKeys)) out[k] = bound(v, depth + 1, b);
  if (entries.length > b.maxKeys) out['__moreKeys'] = entries.length - b.maxKeys;
  return out;
}
