import { z } from 'zod';
import { jsonTypeOf } from '../observation/shape.js';
import { isRecord, parseJsonPath, resolveJsonPath, toFlatPath, type PathSegment } from './jsonpath.js';

/**
 * Data-driven response adapter. A proposal is a list of declarative operations
 * applied to the live response before downstream consumers (and the diff)
 * see it. There is no code in a proposal and nothing is ever evaluated.
 */

const pathSchema = z.string().min(1).max(300);
export const adapterOpSchema = z.discriminatedUnion('op', [
  /** Expose the value found at `from` under `to` (keeps `from` unless `removeSource`). */
  z.object({ op: z.literal('rename'), from: pathSchema, to: pathSchema, removeSource: z.boolean().default(false), onConflict: z.enum(['keep_target', 'prefer_source', 'reject']).default('reject') }).strict(),
  /** Coerce a primitive to another JSON type when the conversion is lossless. */
  z.object({ op: z.literal('coerce'), path: pathSchema, toType: z.enum(['string', 'number', 'boolean']) }).strict(),
  /** Provide a default when the path is missing. Only an explicit value, never computed. */
  z.object({ op: z.literal('default'), path: pathSchema, value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
]);
export type AdapterOp = z.infer<typeof adapterOpSchema>;
export const adapterSpecSchema = z.object({ version: z.literal(1), ops: z.array(adapterOpSchema).min(0).max(50) }).strict();
export type AdapterSpec = z.infer<typeof adapterSpecSchema>;

export interface AdapterTrace {
  op: AdapterOp;
  applied: boolean;
  detail: string;
}
export interface AdapterResult {
  ok: boolean;
  output: unknown;
  trace: AdapterTrace[];
  errors: string[];
}

export const EMPTY_SPEC: AdapterSpec = { version: 1, ops: [] };

/** Apply the spec to a deep copy of `payload`. Pure; identical input yields identical output. */
export function applyAdapter(spec: AdapterSpec, payload: unknown): AdapterResult {
  const output: unknown = structuredClone(payload);
  const trace: AdapterTrace[] = [];
  const errors: string[] = [];
  for (const op of spec.ops) {
    try {
      switch (op.op) {
        case 'rename': {
          const n = renameEach(output, parseJsonPath(op.from), parseJsonPath(op.to), op);
          trace.push({ op, applied: n.applied > 0, detail: n.detail });
          if (n.error) errors.push(n.error);
          break;
        }
        case 'coerce': {
          const n = coerceEach(output, parseJsonPath(op.path), op.toType);
          trace.push({ op, applied: n.applied > 0, detail: n.detail });
          if (n.error) errors.push(n.error);
          break;
        }
        case 'default': {
          const n = defaultEach(output, parseJsonPath(op.path), op.value);
          trace.push({ op, applied: n.applied > 0, detail: n.detail });
          break;
        }
      }
    } catch (err) {
      errors.push(`${op.op}: ${err instanceof Error ? err.message : String(err)}`);
      trace.push({ op, applied: false, detail: 'failed' });
    }
  }
  return { ok: errors.length === 0, output, trace, errors };
}

interface Walk {
  applied: number;
  detail: string;
  error?: string;
}

/** Containers that hold the parent of the path's last segment (handles `[]` fan-out). */
function parents(root: unknown, segs: PathSegment[]): Array<{ container: unknown; last: PathSegment }> {
  if (segs.length === 0) return [];
  const last = segs[segs.length - 1]!;
  const holders = resolveJsonPath(root, segs.slice(0, -1));
  return holders.map((container) => ({ container, last }));
}
function keyOf(seg: PathSegment): string | null {
  return 'key' in seg ? seg.key : null;
}

function renameEach(root: unknown, from: PathSegment[], to: PathSegment[], op: Extract<AdapterOp, { op: 'rename' }>): Walk {
  const fromKey = keyOf(from[from.length - 1]!);
  const toKey = keyOf(to[to.length - 1]!);
  if (!fromKey || !toKey) return { applied: 0, detail: 'rename needs object keys as the last segment', error: 'rename: paths must end in a key' };
  // Both paths must live in the same parent so we can move within one object (also across `[]` fan-out).
  const fromParents = parents(root, from);
  const toParentFlat = toFlatPath(to.slice(0, -1));
  const fromParentFlat = toFlatPath(from.slice(0, -1));
  if (toParentFlat !== fromParentFlat) return { applied: 0, detail: 'cross-parent rename not supported', error: `rename: ${op.from} and ${op.to} must share a parent` };
  let applied = 0;
  let conflicts = 0;
  for (const { container } of fromParents) {
    if (!isRecord(container)) continue;
    const hasFrom = Object.prototype.hasOwnProperty.call(container, fromKey);
    const hasTo = Object.prototype.hasOwnProperty.call(container, toKey);
    if (!hasFrom) continue;
    if (hasTo) {
      if (JSON.stringify(container[toKey]) === JSON.stringify(container[fromKey])) {
        if (op.removeSource) delete container[fromKey];
        continue;
      }
      conflicts++;
      if (op.onConflict === 'reject') return { applied, detail: `conflict: both ${op.from} and ${op.to} present with different values`, error: `rename: conflicting values for ${op.to}` };
      if (op.onConflict === 'keep_target') continue;
    }
    container[toKey] = container[fromKey];
    if (op.removeSource) delete container[fromKey];
    applied++;
  }
  return { applied, detail: applied ? `${op.from} -> ${op.to} on ${applied} object(s)${conflicts ? `, ${conflicts} conflict(s) resolved by ${op.onConflict}` : ''}` : `${op.from} absent; nothing to do` };
}

function coerceEach(root: unknown, path: PathSegment[], toType: 'string' | 'number' | 'boolean'): Walk {
  const key = keyOf(path[path.length - 1]!);
  if (!key) return { applied: 0, detail: 'coerce needs an object key', error: 'coerce: path must end in a key' };
  let applied = 0;
  for (const { container } of parents(root, path)) {
    if (!isRecord(container) || !Object.prototype.hasOwnProperty.call(container, key)) continue;
    const v = container[key];
    if (jsonTypeOf(v) === toType) continue;
    const c = coerce(v, toType);
    if (c.ok) {
      container[key] = c.value;
      applied++;
    } else return { applied, detail: `cannot coerce ${JSON.stringify(v)} to ${toType}`, error: `coerce: ${toFlatPath(path)} value ${JSON.stringify(v)} is not a lossless ${toType}` };
  }
  return { applied, detail: applied ? `coerced ${applied} value(s) to ${toType}` : 'nothing to coerce' };
}
function coerce(v: unknown, toType: 'string' | 'number' | 'boolean'): { ok: true; value: unknown } | { ok: false } {
  switch (toType) {
    case 'string':
      return typeof v === 'number' || typeof v === 'boolean' ? { ok: true, value: String(v) } : { ok: false };
    case 'number': {
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return { ok: true, value: Number(v) };
      if (typeof v === 'boolean') return { ok: false };
      return { ok: false };
    }
    case 'boolean': {
      if (v === 'true' || v === 1) return { ok: true, value: true };
      if (v === 'false' || v === 0) return { ok: true, value: false };
      return { ok: false };
    }
  }
}

function defaultEach(root: unknown, path: PathSegment[], value: string | number | boolean | null): Walk {
  const key = keyOf(path[path.length - 1]!);
  if (!key) return { applied: 0, detail: 'default needs an object key' };
  let applied = 0;
  for (const { container } of parents(root, path)) {
    if (!isRecord(container) || Object.prototype.hasOwnProperty.call(container, key)) continue;
    container[key] = value;
    applied++;
  }
  return { applied, detail: applied ? `defaulted ${applied} object(s)` : 'path already present everywhere' };
}

/** Human-readable rendering shown in the UI instead of code. Deterministic. */
export function describeAdapter(spec: AdapterSpec): string {
  const p = (path: string): string => path.replace(/^\$\.?/, '') || '$';
  const lines = ['# Controlled response adapter (declarative, no code is executed)', `# ${spec.ops.length} operation(s), applied in order to every live response before it reaches consumers`, ''];
  spec.ops.forEach((op, i) => {
    switch (op.op) {
      case 'rename':
        lines.push(`${i + 1}. rename   ${p(op.from)}  ->  ${p(op.to)}`, `      keep source: ${op.removeSource ? 'no' : 'yes'}   on conflict: ${op.onConflict}`);
        break;
      case 'coerce':
        lines.push(`${i + 1}. coerce   ${p(op.path)}  ->  ${op.toType} (lossless conversions only, otherwise reject)`);
        break;
      case 'default':
        lines.push(`${i + 1}. default  ${p(op.path)}  :=  ${JSON.stringify(op.value)} (only when the field is missing)`);
        break;
    }
  });
  if (spec.ops.length === 0) lines.push('(no transformation: manual review required)');
  lines.push('', JSON.stringify(spec, null, 2));
  return lines.join('\n');
}
