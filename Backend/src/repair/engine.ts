import { createHash } from 'node:crypto';
import { INTERNAL_CONTRACTS, type AdapterEndpointDefinition, type BaseMapping } from './adapters.js';
import type { Policy, Transform, ValueType } from './schemas.js';
import { redactValue } from '../security/redact.js';

/**
 * The controlled adapter interface. `normalize()` is a pure function:
 * payload + definition + transforms + policy -> internal record or a list of
 * rejections, plus a trace. It never mutates its input, never evaluates
 * code, and rejects instead of guessing.
 */

export type RejectionCode =
  | 'MISSING_FIELD'
  | 'NULL_VALUE'
  | 'TYPE_MISMATCH'
  | 'CONFLICTING_VALUES'
  | 'UNEXPECTED_FIELDS'
  | 'UNMAPPED_ENUM_VALUE'
  | 'CONTRACT_VIOLATION'
  | 'INVALID_PAYLOAD'
  | 'AMBIGUOUS_MAPPING';

export interface Rejection {
  code: RejectionCode;
  path: string;
  message: string;
}

export interface TraceStep {
  step: string;
  detail: Record<string, unknown>;
}

export interface NormalizeResult {
  ok: boolean;
  /** Validated internal record (or array of records for list endpoints). */
  output: unknown;
  rejections: Rejection[];
  trace: TraceStep[];
  /** External fields no mapping consumed (always reported, dropped unless policy rejects). */
  droppedFields: string[];
  contractValid: boolean | null;
  inputHash: string;
  outputHash: string | null;
}

export interface NormalizeInput {
  definition: AdapterEndpointDefinition;
  payload: unknown;
  transforms: Transform[];
  policy: Policy;
}

const DEFAULT_POLICY: Policy = { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false };

export function normalize(input: NormalizeInput): NormalizeResult {
  const policy = { ...DEFAULT_POLICY, ...input.policy };
  const trace: TraceStep[] = [];
  const inputHash = hash(input.payload);
  if (!isRecord(input.payload)) {
    return finish({ ok: false, output: null, rejections: [{ code: 'INVALID_PAYLOAD', path: '', message: 'payload must be a JSON object' }], trace, droppedFields: [], contractValid: null, inputHash, outputHash: null });
  }
  const def = input.definition;
  const plan = buildPlan(def.baseMapping, input.transforms, trace);
  if (plan.rejections.length) {
    return finish({ ok: false, output: null, rejections: plan.rejections, trace, droppedFields: [], contractValid: null, inputHash, outputHash: null });
  }

  if (def.itemsPath) {
    const items = getPath(input.payload, def.itemsPath);
    if (!Array.isArray(items)) {
      return finish({ ok: false, output: null, rejections: [{ code: 'INVALID_PAYLOAD', path: def.itemsPath, message: `expected an array at ${def.itemsPath}` }], trace, droppedFields: [], contractValid: null, inputHash, outputHash: null });
    }
    const outputs: unknown[] = [];
    const rejections: Rejection[] = [];
    const dropped = new Set<string>();
    items.forEach((item, i) => {
      const r = normalizeOne(item, plan, def, policy, trace, `${def.itemsPath}[${i}]`);
      r.droppedFields.forEach((f) => dropped.add(f));
      if (r.ok) outputs.push(r.output);
      rejections.push(...r.rejections);
    });
    const ok = rejections.length === 0;
    return finish({ ok, output: ok ? outputs : null, rejections, trace, droppedFields: [...dropped].sort(), contractValid: ok ? true : rejections.some((r) => r.code === 'CONTRACT_VIOLATION') ? false : null, inputHash, outputHash: ok ? hash(outputs) : null });
  }

  const r = normalizeOne(input.payload, plan, def, policy, trace, '');
  return finish({ ...r, trace, inputHash, outputHash: r.ok ? hash(r.output) : null });
}

interface PlanEntry {
  internalField: string;
  expectedType: ValueType;
  /** Candidate external paths in priority order (renames put the new path first, old path second for conflict detection). */
  sources: Array<{ path: string; role: 'base' | 'renamed' | 'mapped' }>;
  enumMapping?: { mapping: Record<string, string>; allowed: string[] };
  default?: string | number | boolean;
}
interface Plan {
  entries: PlanEntry[];
  rejections: Rejection[];
}

/** Overlay transforms on the base mapping. Conflicting transforms on one internal field are rejected as ambiguous. */
function buildPlan(base: BaseMapping[], transforms: Transform[], trace: TraceStep[]): Plan {
  const entries = new Map<string, PlanEntry>();
  for (const m of base) entries.set(m.internalField, { internalField: m.internalField, expectedType: m.expectedType, sources: [{ path: m.from, role: 'base' }] });
  const rejections: Rejection[] = [];
  const touched = new Map<string, string>();
  const claim = (field: string, by: string): boolean => {
    const prev = touched.get(field);
    if (prev && prev !== by) {
      rejections.push({ code: 'AMBIGUOUS_MAPPING', path: field, message: `internal field "${field}" is targeted by more than one transform (${prev}, ${by})` });
      return false;
    }
    touched.set(field, by);
    return true;
  };
  transforms.forEach((t, i) => {
    const by = `${t.type}#${i}`;
    switch (t.type) {
      case 'rename_field': {
        if (!claim(t.internalField, by)) break;
        const e = entries.get(t.internalField) ?? { internalField: t.internalField, expectedType: t.expectedType, sources: [] };
        e.expectedType = t.expectedType;
        e.sources = [{ path: t.renamedTo, role: 'renamed' }, { path: t.from, role: 'base' }];
        entries.set(t.internalField, e);
        trace.push({ step: 'plan.rename_field', detail: { internalField: t.internalField, from: t.from, renamedTo: t.renamedTo } });
        break;
      }
      case 'field_path_mapping': {
        for (const m of t.mappings) {
          if (!claim(m.internalField, by)) continue;
          const e: PlanEntry = { internalField: m.internalField, expectedType: m.expectedType, sources: [{ path: m.from, role: 'mapped' }] };
          if (m.default !== undefined) e.default = m.default;
          entries.set(m.internalField, e);
          trace.push({ step: 'plan.field_path_mapping', detail: { internalField: m.internalField, from: m.from } });
        }
        break;
      }
      case 'enum_mapping': {
        if (!claim(t.internalField, by)) break;
        const e = entries.get(t.internalField) ?? { internalField: t.internalField, expectedType: 'string', sources: [] };
        e.sources = [{ path: t.from, role: 'mapped' }];
        e.expectedType = 'string';
        e.enumMapping = { mapping: t.mapping, allowed: t.allowedInternalValues };
        entries.set(t.internalField, e);
        trace.push({ step: 'plan.enum_mapping', detail: { internalField: t.internalField, from: t.from, values: Object.keys(t.mapping).length } });
        break;
      }
    }
  });
  return { entries: [...entries.values()], rejections };
}

function normalizeOne(payload: unknown, plan: Plan, def: AdapterEndpointDefinition, policy: Policy, trace: TraceStep[], prefix: string): Omit<NormalizeResult, 'trace' | 'inputHash' | 'outputHash'> {
  const at = (p: string): string => (prefix ? `${prefix}.${p}` : p);
  if (!isRecord(payload)) return { ok: false, output: null, rejections: [{ code: 'INVALID_PAYLOAD', path: prefix, message: 'item must be a JSON object' }], droppedFields: [], contractValid: null };
  const out: Record<string, unknown> = {};
  const rejections: Rejection[] = [];
  const consumed = new Set<string>();

  for (const e of plan.entries) {
    const present = e.sources.map((s) => ({ ...s, value: getPath(payload, s.path), exists: hasPath(payload, s.path) })).filter((s) => s.exists);
    for (const s of present) consumed.add(s.path.split('.')[0] as string);

    if (present.length === 0) {
      if (policy.onMissing === 'default' && e.default !== undefined) {
        out[e.internalField] = e.default;
        trace.push({ step: 'apply.default', detail: { internalField: e.internalField, value: e.default } });
      } else if (policy.onMissing === 'null') {
        out[e.internalField] = null;
      } else {
        rejections.push({ code: 'MISSING_FIELD', path: at(e.sources[0]?.path ?? e.internalField), message: `no source for internal field "${e.internalField}" (looked at ${e.sources.map((s) => s.path).join(', ')})` });
      }
      continue;
    }
    // Conflict: old and renamed sources both present with different values.
    if (present.length > 1) {
      const distinct = new Set(present.map((s) => JSON.stringify(s.value)));
      if (distinct.size > 1) {
        if (policy.onConflict === 'reject') {
          rejections.push({ code: 'CONFLICTING_VALUES', path: at(present.map((s) => s.path).join('|')), message: `sources for "${e.internalField}" disagree: ${present.map((s) => `${s.path}=${JSON.stringify(s.value)}`).join(', ')}` });
          continue;
        }
        trace.push({ step: 'apply.conflict_resolved', detail: { internalField: e.internalField, policy: policy.onConflict } });
      }
    }
    const chosen = policy.onConflict === 'prefer_old' && present.length > 1 ? (present.find((s) => s.role === 'base') ?? present[0]) : present[0];
    if (!chosen) continue;
    let value: unknown = chosen.value;

    if (value === null) {
      if (policy.onNull === 'keep_null') {
        out[e.internalField] = null;
      } else {
        rejections.push({ code: 'NULL_VALUE', path: at(chosen.path), message: `"${chosen.path}" is null` });
      }
      continue;
    }
    if (e.enumMapping) {
      if (typeof value !== 'string') {
        rejections.push({ code: 'TYPE_MISMATCH', path: at(chosen.path), message: `enum source must be a string, got ${jsonType(value)}` });
        continue;
      }
      const mapped = Object.prototype.hasOwnProperty.call(e.enumMapping.mapping, value) ? e.enumMapping.mapping[value] : undefined;
      if (mapped === undefined) {
        rejections.push({ code: 'UNMAPPED_ENUM_VALUE', path: at(chosen.path), message: `value "${value}" has no approved mapping (known: ${Object.keys(e.enumMapping.mapping).join(', ')})` });
        continue;
      }
      trace.push({ step: 'apply.enum_mapping', detail: { internalField: e.internalField, from: value, to: mapped } });
      value = mapped;
    } else {
      const typed = coerce(value, e.expectedType, policy.allowNumericStrings);
      if (!typed.ok) {
        rejections.push({ code: 'TYPE_MISMATCH', path: at(chosen.path), message: `expected ${e.expectedType}, got ${jsonType(value)}` });
        continue;
      }
      value = typed.value;
    }
    out[e.internalField] = value;
    if (chosen.role !== 'base') trace.push({ step: 'apply.mapped', detail: { internalField: e.internalField, from: chosen.path, role: chosen.role } });
  }

  const droppedFields = Object.keys(payload).filter((k) => !consumed.has(k)).sort();
  if (droppedFields.length && policy.onExtraFields === 'reject') {
    rejections.push({ code: 'UNEXPECTED_FIELDS', path: prefix, message: `unexpected external fields: ${droppedFields.join(', ')}` });
  }
  if (rejections.length) return { ok: false, output: null, rejections, droppedFields, contractValid: null };

  const contract = INTERNAL_CONTRACTS[def.contract].safeParse(out);
  if (!contract.success) {
    return {
      ok: false,
      output: null,
      rejections: contract.error.issues.map((i) => ({ code: 'CONTRACT_VIOLATION' as const, path: at(i.path.map(String).join('.') || '(root)'), message: i.message })),
      droppedFields,
      contractValid: false,
    };
  }
  trace.push({ step: 'contract.validated', detail: { contract: def.contract, ...(prefix ? { item: prefix } : {}) } });
  return { ok: true, output: contract.data, rejections: [], droppedFields, contractValid: true };
}

function coerce(value: unknown, type: ValueType, allowNumericStrings: boolean): { ok: true; value: unknown } | { ok: false } {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? { ok: true, value } : { ok: false };
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case 'number':
    case 'integer': {
      let n: unknown = value;
      if (typeof value === 'string' && allowNumericStrings && /^-?\d+(\.\d+)?$/.test(value)) n = Number(value);
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false };
      if (type === 'integer' && !Number.isInteger(n)) return { ok: false };
      return { ok: true, value: n };
    }
  }
}

function finish(r: NormalizeResult): NormalizeResult {
  return { ...r, output: r.output === null ? null : redactValue(r.output) };
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (!isRecord(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}
export function hasPath(obj: unknown, path: string): boolean {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (!isRecord(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return false;
    cur = cur[seg];
  }
  return true;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function jsonType(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

/** SHA-256 over canonical JSON (sorted keys). */
export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
