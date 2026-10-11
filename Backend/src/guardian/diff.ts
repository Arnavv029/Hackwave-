import { jsonTypeOf } from '../observation/shape.js';
import type { JsonType } from '../observation/schemas.js';
import { isRecord } from './jsonpath.js';

/**
 * Response diff algorithm (Phase 9).
 *
 * Compares the approved baseline snapshot of a URL with a freshly observed
 * body and explains the difference as a list of field-level changes:
 *
 *   removed        a field the baseline had is gone
 *   added          a field appears that the baseline never had
 *   type_mismatch  same field, different JSON type (null is treated as "nullable", not a type change)
 *   renamed        a removed field and an added field that very likely carry the same data
 *   value_changed  same field and type, different value (informational; volatile fields are skipped)
 *
 * Everything is derived from the two documents: no field names, no provider
 * knowledge and no fixed vocabulary are built in. Thresholds are inputs.
 * Arrays are compared by shape (`items[]`), so a list of 3 vs 300 elements is
 * not a change, but a missing key inside the elements is.
 */

export interface DiffOptions {
  /** Minimum rename score (0..1) for a removed/added pair to be reported as a rename. */
  renameThreshold?: number;
  /** Flat paths whose values are expected to vary between calls (ids, timestamps...). Glob `*` allowed. */
  volatileFields?: string[];
  /** Cap on the number of value_changed entries reported. */
  maxValueChanges?: number;
}

export type FieldChangeType = 'removed' | 'added' | 'type_mismatch' | 'renamed' | 'value_changed';

export interface FieldChange {
  changeType: FieldChangeType;
  /** Flat path in the baseline (`items[].sku`); for `added` it is the new path. */
  path: string;
  /** For renames: the new path. */
  newPath?: string;
  /** Human-readable baseline side. */
  expected: string;
  /** Human-readable observed side. */
  actual: string;
  baselineTypes?: JsonType[];
  currentTypes?: JsonType[];
  /** For renames: why we think so. */
  evidence?: { nameSimilarity: number; valueMatch: boolean; typeCompatible: boolean; sameParent: boolean; singleSwap: boolean; childOverlap: number | null; score: number };
}

export interface ResponseDiff {
  identical: boolean;
  /** Breaking = at least one removed, renamed or type-changed field. */
  breaking: boolean;
  changes: FieldChange[];
  counts: Record<FieldChangeType, number>;
  baselineFieldCount: number;
  currentFieldCount: number;
  renameThreshold: number;
}

interface FlatField {
  path: string;
  types: Set<JsonType>;
  /** Representative primitive value (first seen); undefined for containers. */
  sample: unknown;
  parent: string;
  leaf: string;
}

const DEFAULT_RENAME_THRESHOLD = 0.55;
const DEFAULT_MAX_VALUE_CHANGES = 50;

/** Flatten a JSON document into path -> {types, sample}; array items merge under `[]`. */
export function flatten(value: unknown, maxDepth = 10): Map<string, FlatField> {
  const out = new Map<string, FlatField>();
  const visit = (v: unknown, path: string, depth: number): void => {
    if (v === undefined) return;
    const type = jsonTypeOf(v);
    if (path) {
      let f = out.get(path);
      if (!f) {
        const dot = path.lastIndexOf('.');
        f = { path, types: new Set(), sample: undefined, parent: dot >= 0 ? path.slice(0, dot) : '', leaf: dot >= 0 ? path.slice(dot + 1) : path };
        out.set(path, f);
      }
      f.types.add(type);
      if (f.sample === undefined && type !== 'object' && type !== 'array' && type !== 'null') f.sample = v;
    }
    if (depth >= maxDepth) return;
    if (type === 'array') for (const item of v as unknown[]) visit(item, `${path}[]`, depth + 1);
    else if (type === 'object') for (const [k, child] of Object.entries(v as Record<string, unknown>)) visit(child, path ? `${path}.${k}` : k, depth + 1);
  };
  visit(value, '', 0);
  return out;
}

function nonNull(types: Set<JsonType>): JsonType[] {
  return [...types].filter((t) => t !== 'null').sort();
}
function typesCompatible(a: Set<JsonType>, b: Set<JsonType>): boolean {
  const x = nonNull(a);
  const y = nonNull(b);
  if (x.length === 0 || y.length === 0) return true;
  return x.some((t) => y.includes(t));
}
function describeTypes(types: Set<JsonType>): string {
  return [...types].sort().join(' | ');
}
function describeValue(v: unknown, types: Set<JsonType>): string {
  if (v === undefined) return describeTypes(types);
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? `${v.slice(0, 57)}…` : v);
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
}

/** Token-based name similarity in 0..1 (case, separators and plural suffixes ignored). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if ([...ta].join('') === [...tb].join('')) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? inter / union : 0;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(jaccard, lev * 0.9);
}
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t));
}
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[\]/g, '\\[\\]').replace(/\*/g, '[^.]*')}$`);
}
function isVolatile(path: string, leaf: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path) || p.test(leaf));
}

/** Relative child paths of a container (`items` -> `[].sku`, `[].qty`), used to recognise renamed containers by structure. */
function childrenOf(map: Map<string, FlatField>, path: string): Set<string> {
  const out = new Set<string>();
  for (const p of map.keys()) {
    if (p.startsWith(`${path}.`)) out.add(p.slice(path.length + 1));
    else if (p.startsWith(`${path}[]`)) out.add(p.slice(path.length));
  }
  return out;
}
function childOverlap(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common / new Set([...a, ...b]).size;
}

/** True when `path` is a descendant of `parent` (`a.b`, `a[]`, `a[].b`). */
function isUnder(path: string, parent: string): boolean {
  return path.startsWith(`${parent}.`) || path.startsWith(`${parent}[]`);
}

function sampleEquals(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffResponses(baseline: unknown, current: unknown, opts: DiffOptions = {}): ResponseDiff {
  const threshold = opts.renameThreshold ?? DEFAULT_RENAME_THRESHOLD;
  const volatile = (opts.volatileFields ?? []).map(globToRegExp);
  const base = flatten(baseline);
  const curr = flatten(current);
  const changes: FieldChange[] = [];

  // Root type change (object -> array, object -> primitive...) is reported once and dominates.
  const rootBase = jsonTypeOf(baseline);
  const rootCurr = jsonTypeOf(current);
  if (rootBase !== rootCurr && !(isRecord(baseline) && isRecord(current))) {
    changes.push({ changeType: 'type_mismatch', path: '$', expected: rootBase, actual: rootCurr, baselineTypes: [rootBase], currentTypes: [rootCurr] });
  }

  const removed: FlatField[] = [];
  const added: FlatField[] = [];
  let valueChanges = 0;
  for (const [path, f] of base) {
    const c = curr.get(path);
    if (!c) {
      removed.push(f);
      continue;
    }
    if (!typesCompatible(f.types, c.types)) {
      changes.push({ changeType: 'type_mismatch', path, expected: `${path}: ${describeTypes(f.types)}`, actual: `${path}: ${describeTypes(c.types)}`, baselineTypes: [...f.types], currentTypes: [...c.types] });
      continue;
    }
    if (f.sample !== undefined && c.sample !== undefined && !sampleEquals(f.sample, c.sample) && !isVolatile(path, f.leaf, volatile) && valueChanges < (opts.maxValueChanges ?? DEFAULT_MAX_VALUE_CHANGES)) {
      valueChanges++;
      changes.push({ changeType: 'value_changed', path, expected: `${path}: ${describeValue(f.sample, f.types)}`, actual: `${path}: ${describeValue(c.sample, c.types)}`, baselineTypes: [...f.types], currentTypes: [...c.types] });
    }
  }
  for (const [path, c] of curr) if (!base.has(path)) added.push(c);

  // Rename detection: score every removed/added pair, accept greedily above the threshold.
  // Children of a renamed container (`a.x` -> `b.x`) are folded into the parent rename.
  const pairs: Array<{ r: FlatField; a: FlatField; score: number; ev: NonNullable<FieldChange['evidence']> }> = [];
  for (const r of removed) {
    for (const a of added) {
      const typeCompatible = typesCompatible(r.types, a.types);
      if (!typeCompatible) continue;
      const sameParent = r.parent === a.parent;
      const sim = nameSimilarity(r.leaf, a.leaf);
      const valueMatch = sampleEquals(r.sample, a.sample);
      const removedInParent = removed.filter((x) => x.parent === r.parent).length;
      const addedInParent = added.filter((x) => x.parent === a.parent).length;
      const singleSwap = sameParent && removedInParent === 1 && addedInParent === 1;
      // Containers: identical child structure is strong evidence the whole object/array moved under a new key.
      const overlap = childOverlap(childrenOf(base, r.path), childrenOf(curr, a.path));
      let score = 0.5 * sim + (valueMatch ? 0.35 : 0) + (sameParent ? 0.1 : 0) + 0.05 + (overlap !== null ? 0.6 * overlap : 0);
      if (singleSwap) score = Math.max(score, 0.6);
      if (!sameParent) score -= 0.15;
      if (score >= threshold) pairs.push({ r, a, score: Math.min(1, score), ev: { nameSimilarity: Number(sim.toFixed(2)), valueMatch, typeCompatible, sameParent, singleSwap, childOverlap: overlap === null ? null : Number(overlap.toFixed(2)), score: Number(Math.min(1, score).toFixed(2)) } });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const usedR = new Set<string>();
  const usedA = new Set<string>();
  const renamedPrefixes: Array<[string, string]> = [];
  for (const p of pairs) {
    if (usedR.has(p.r.path) || usedA.has(p.a.path)) continue;
    if (renamedPrefixes.some(([from, to]) => isUnder(p.r.path, from) && isUnder(p.a.path, to))) {
      usedR.add(p.r.path);
      usedA.add(p.a.path);
      continue;
    }
    usedR.add(p.r.path);
    usedA.add(p.a.path);
    renamedPrefixes.push([p.r.path, p.a.path]);
    changes.push({ changeType: 'renamed', path: p.r.path, newPath: p.a.path, expected: `${p.r.path}: ${describeValue(p.r.sample, p.r.types)}`, actual: `${p.a.path}: ${describeValue(p.a.sample, p.a.types)}`, baselineTypes: [...p.r.types], currentTypes: [...p.a.types], evidence: p.ev });
  }
  // A renamed container makes its children look renamed too; keep only the outermost rename.
  for (const [from, to] of renamedPrefixes) {
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i]!;
      if (c.changeType === 'renamed' && c.path !== from && isUnder(c.path, from) && c.newPath && isUnder(c.newPath, to)) changes.splice(i, 1);
    }
  }
  // Fold descendants of a renamed/removed container so a renamed object is one change, not ten.
  const removedRoots = removed.filter((f) => !usedR.has(f.path) && !removed.some((o) => o !== f && isUnder(f.path, o.path) && !usedR.has(o.path)) && !renamedPrefixes.some(([from]) => isUnder(f.path, from)));
  const addedRoots = added.filter((f) => !usedA.has(f.path) && !added.some((o) => o !== f && isUnder(f.path, o.path) && !usedA.has(o.path)) && !renamedPrefixes.some(([, to]) => isUnder(f.path, to)));
  for (const f of removedRoots) changes.push({ changeType: 'removed', path: f.path, expected: `${f.path}: ${describeValue(f.sample, f.types)}`, actual: 'missing in response', baselineTypes: [...f.types] });
  for (const f of addedRoots) changes.push({ changeType: 'added', path: f.path, expected: 'not present in baseline', actual: `${f.path}: ${describeValue(f.sample, f.types)}`, currentTypes: [...f.types] });

  const order: Record<FieldChangeType, number> = { removed: 0, type_mismatch: 1, renamed: 2, added: 3, value_changed: 4 };
  changes.sort((x, y) => order[x.changeType] - order[y.changeType] || x.path.localeCompare(y.path));
  const counts: Record<FieldChangeType, number> = { removed: 0, added: 0, type_mismatch: 0, renamed: 0, value_changed: 0 };
  for (const c of changes) counts[c.changeType]++;
  const breaking = counts.removed + counts.renamed + counts.type_mismatch > 0;
  return { identical: changes.length === 0, breaking, changes, counts, baselineFieldCount: base.size, currentFieldCount: curr.size, renameThreshold: threshold };
}

/** Stable identity of a diff for incident deduplication (value changes are ignored). */
export function diffFingerprint(d: ResponseDiff): string {
  return d.changes
    .filter((c) => c.changeType !== 'value_changed')
    .map((c) => `${c.changeType}:${c.path}${c.newPath ? `>${c.newPath}` : ''}`)
    .sort()
    .join('|');
}
