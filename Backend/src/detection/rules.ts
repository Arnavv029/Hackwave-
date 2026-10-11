import type { Severity } from '../generated/prisma/client.js';
import type { StoredObservation } from '../observation/store.js';
import type { DetectionConfig } from './config.js';
import { normalizeObservation, type NormalizedObservation } from './normalize.js';
import { latencyStats, type BaselineSummary } from './summary.js';

/**
 * Deterministic detection rules. Each rule looks at the current observation,
 * the active baseline summary and a rolling window of recent observations
 * for the same endpoint, and emits zero or more findings with evidence.
 *
 * STRUCTURAL rules fire on facts visible in a single observation (a field is
 * gone). STATISTICAL rules only fire once the window holds enough samples and
 * a configured threshold is exceeded. No rule claims to know what a change
 * means; rename detection in particular yields *candidates*.
 */

export type DetectionKindValue = 'STRUCTURAL' | 'STATISTICAL';
export type RuleCategory = 'STRUCTURAL' | 'BEHAVIORAL' | 'OPERATIONAL' | 'AVAILABILITY' | 'RATE_LIMIT';

export const RULE_IDS = [
  'structural.field_removed',
  'structural.field_added',
  'structural.rename_candidate',
  'structural.type_changed',
  'structural.nullability_changed',
  'behavioral.status_changed',
  'behavioral.enum_value_changed',
  'operational.latency_regression',
  'operational.error_rate_increase',
  'availability.timeout_rate_increase',
  'availability.unavailable_rate_increase',
  'rate_limit.rate_increase',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface RuleFinding {
  rule: RuleId;
  kind: DetectionKindValue;
  category: RuleCategory;
  severity: Severity;
  /** 0..1 */
  confidence: number;
  /** Stable within a baseline: `${rule}|${subject}`. */
  fingerprint: string;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface RuleContext {
  observation: StoredObservation;
  baseline: BaselineSummary;
  /** Recent observations for the same endpoint/context, newest first, INCLUDING the current one. */
  window: StoredObservation[];
  config: DetectionConfig;
}

export function runRules(ctx: RuleContext): RuleFinding[] {
  const current = normalizeObservation(ctx.observation, ctx.config);
  const window = ctx.window.map((o) => normalizeObservation(o, ctx.config));
  const findings: RuleFinding[] = [
    ...structuralRules(current, window, ctx),
    ...statusRule(current, ctx),
    ...enumRule(current, ctx),
    ...latencyRule(window, ctx),
    ...rateRules(window, ctx),
  ];
  // Deterministic ordering: severity, then rule, then fingerprint.
  return findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.fingerprint.localeCompare(b.fingerprint));
}

const SEVERITY_RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s];
}

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

function structuralRules(current: NormalizedObservation, window: NormalizedObservation[], ctx: RuleContext): RuleFinding[] {
  if (!current.fields || current.statusCode === null || current.statusCode < 200 || current.statusCode >= 300) return [];
  const { baseline, config } = ctx;
  if (baseline.jsonSuccessCount === 0) return [];
  const out: RuleFinding[] = [];
  const jsonWindow = window.filter((w) => w.fields !== null);

  // How many recent observations share the same fact: confidence grows with
  // the number of consistent observations, saturating once the window holds
  // `window.minSamples` of them, so a one-off stays below a persistent change.
  const recurrence = (test: (n: NormalizedObservation) => boolean): { matching: number; of: number } => ({
    matching: jsonWindow.filter(test).length,
    of: jsonWindow.length,
  });
  const confidenceFrom = (r: { matching: number; of: number }, base: number): number =>
    Math.min(0.99, base + 0.3 * Math.min(1, r.matching / Math.max(r.of, config.window.minSamples)));

  const removed: Array<{ path: string; stats: BaselineSummary['fields'][string] }> = [];
  const added: string[] = [];

  for (const [path, stats] of Object.entries(baseline.fields)) {
    if (current.fields.has(path)) continue;
    // A parent that disappeared already explains its children.
    if (parentMissing(path, current.fields, baseline.fields)) continue;
    if (stats.presence < config.requiredPresenceRatio) continue; // optional in baseline: silence
    removed.push({ path, stats });
  }
  for (const path of current.fields.keys()) {
    if (baseline.fields[path]) continue;
    if (parentIsNew(path, baseline.fields)) continue;
    added.push(path);
  }

  for (const { path, stats } of removed) {
    const rec = recurrence((n) => n.fields !== null && !n.fields.has(path));
    out.push({
      rule: 'structural.field_removed',
      kind: 'STRUCTURAL',
      category: 'STRUCTURAL',
      severity: stats.presence >= 0.999 ? 'HIGH' : 'MEDIUM',
      confidence: confidenceFrom(rec, 0.6),
      fingerprint: `structural.field_removed|${path}`,
      summary: `Field \`${path}\` was present in ${pct(stats.presence)} of baseline samples and is missing`,
      evidence: { path, before: stats, after: null, window: rec },
    });
  }
  for (const path of added) {
    const rec = recurrence((n) => n.fields !== null && n.fields.has(path));
    const field = current.fields.get(path);
    out.push({
      rule: 'structural.field_added',
      kind: 'STRUCTURAL',
      category: 'STRUCTURAL',
      severity: 'LOW',
      confidence: confidenceFrom(rec, 0.6),
      fingerprint: `structural.field_added|${path}`,
      summary: `Field \`${path}\` is new (never seen in ${baseline.jsonSuccessCount} baseline samples). Additive changes are not assumed breaking`,
      evidence: { path, before: null, after: field, window: rec },
    });
  }

  // Rename candidates: a removed and an added field under the same parent with
  // compatible types, where at least one of these holds: the names are similar,
  // a sampled value matches, or it is a strict one-for-one swap within that
  // parent. Reported as a candidate; it never suppresses the removed/added
  // findings, and a candidate is not evidence of semantic equivalence.
  for (const { path: oldPath, stats } of removed) {
    for (const newPath of added) {
      if (parentOf(oldPath) !== parentOf(newPath)) continue;
      const newField = current.fields.get(newPath);
      if (!newField) continue;
      const typeCompatible = stats.types.length === 0 || newField.types.length === 0 || stats.types.some((t) => newField.types.includes(t));
      if (!typeCompatible) continue;
      const similarity = nameSimilarity(leafOf(oldPath), leafOf(newPath));
      const oldValues = Object.keys(stats.values ?? {});
      const newValues = (current.values.get(newPath) ?? []).map(String);
      const valueOverlap = oldValues.length > 0 && newValues.some((v) => oldValues.includes(v));
      const parent = parentOf(oldPath);
      const singleSwap = removed.filter((r) => parentOf(r.path) === parent).length === 1 && added.filter((a) => parentOf(a) === parent).length === 1;
      const reasons: string[] = [];
      if (similarity >= config.renameSimilarityThreshold) reasons.push('similar_name');
      if (valueOverlap) reasons.push('value_overlap');
      if (singleSwap) reasons.push('single_swap');
      if (reasons.length === 0) continue;
      out.push({
        rule: 'structural.rename_candidate',
        kind: 'STRUCTURAL',
        category: 'STRUCTURAL',
        severity: 'MEDIUM',
        confidence: Math.min(0.9, 0.2 + similarity * 0.4 + (valueOverlap ? 0.2 : 0) + (singleSwap ? 0.15 : 0)),
        fingerprint: `structural.rename_candidate|${oldPath}->${newPath}`,
        summary: `\`${oldPath}\` disappeared while \`${newPath}\` appeared with a compatible type (${reasons.join(', ')}): possible rename (candidate only, not verified)`,
        evidence: {
          from: oldPath,
          to: newPath,
          reasons,
          nameSimilarity: round2(similarity),
          typeCompatible,
          valueOverlap,
          singleSwap,
          beforeTypes: stats.types,
          afterTypes: newField.types,
          note: 'Structural similarity does not establish semantic equivalence.',
        },
      });
    }
  }

  // Type and nullability changes on fields present in both.
  for (const [path, field] of current.fields) {
    const stats = baseline.fields[path];
    if (!stats) continue;
    const newTypes = field.types.filter((t) => !stats.types.includes(t));
    if (newTypes.length > 0 && stats.types.length > 0) {
      const rec = recurrence((n) => {
        const f = n.fields?.get(path);
        return f !== undefined && f.types.some((t) => !stats.types.includes(t));
      });
      out.push({
        rule: 'structural.type_changed',
        kind: 'STRUCTURAL',
        category: 'STRUCTURAL',
        severity: 'HIGH',
        confidence: confidenceFrom(rec, 0.65),
        fingerprint: `structural.type_changed|${path}`,
        summary: `Field \`${path}\` was ${stats.types.join('|')} in the baseline and is now ${field.types.join('|')}`,
        evidence: { path, before: { types: stats.types }, after: { types: field.types }, window: rec },
      });
    }
    if (field.nullable && stats.nullRate === 0 && baseline.jsonSuccessCount >= config.window.minSamples) {
      const rec = recurrence((n) => n.fields?.get(path)?.nullable === true);
      out.push({
        rule: 'structural.nullability_changed',
        kind: 'STRUCTURAL',
        category: 'STRUCTURAL',
        severity: 'MEDIUM',
        confidence: confidenceFrom(rec, 0.55),
        fingerprint: `structural.nullability_changed|${path}`,
        summary: `Field \`${path}\` was never null in ${baseline.jsonSuccessCount} baseline samples and is now null`,
        evidence: { path, before: { nullRate: 0, samples: baseline.jsonSuccessCount }, after: { nullable: true }, window: rec },
      });
    }
  }
  return out;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(0, i);
}
function leafOf(path: string): string {
  const i = path.lastIndexOf('.');
  return (i === -1 ? path : path.slice(i + 1)).replace(/\[\]$/, '');
}
function parentMissing(path: string, current: Map<string, unknown>, baselineFields: Record<string, unknown>): boolean {
  let p = parentOf(path);
  while (p) {
    if (baselineFields[p] && !current.has(p)) return true;
    p = parentOf(p);
  }
  return false;
}
function parentIsNew(path: string, baselineFields: Record<string, unknown>): boolean {
  let p = parentOf(path);
  while (p) {
    if (!baselineFields[p]) return true;
    p = parentOf(p);
  }
  return false;
}

/** Token-aware similarity of two field names in 0..1 (shared tokens + character overlap). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = ta.filter((t) => tb.includes(t)).length;
  const tokenScore = ta.length && tb.length ? (2 * shared) / (ta.length + tb.length) : 0;
  const charScore = 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length, 1);
  return Math.max(tokenScore, charScore);
}
function tokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j] as number;
      prev[j] = Math.min((prev[j] as number) + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

// ---------------------------------------------------------------------------
// Behavioural
// ---------------------------------------------------------------------------

function statusRule(current: NormalizedObservation, ctx: RuleContext): RuleFinding[] {
  const key = current.statusCode === null ? 'none' : String(current.statusCode);
  if (ctx.baseline.statusCodes[key]) return [];
  const status = current.statusCode;
  const severity: Severity = status === null || status >= 500 ? 'HIGH' : status === 429 ? 'MEDIUM' : status >= 400 ? 'MEDIUM' : 'LOW';
  return [
    {
      rule: 'behavioral.status_changed',
      kind: 'STRUCTURAL',
      category: status === null || status === 502 || status === 503 || status === 504 ? 'AVAILABILITY' : status === 429 ? 'RATE_LIMIT' : 'BEHAVIORAL',
      severity,
      confidence: 0.6,
      fingerprint: `behavioral.status_changed|${key}`,
      summary: status === null ? `No HTTP response (${current.outcome}); the baseline always received one` : `HTTP ${status} was never seen in the baseline (seen: ${Object.keys(ctx.baseline.statusCodes).join(', ')})`,
      evidence: { before: ctx.baseline.statusCodes, after: { statusCode: status, outcome: current.outcome, errorCategory: current.errorCategory }, note: 'Single occurrence; see rate rules for persistence.' },
    },
  ];
}

function enumRule(current: NormalizedObservation, ctx: RuleContext): RuleFinding[] {
  if (!current.fields) return [];
  const out: RuleFinding[] = [];
  for (const [path, stats] of Object.entries(ctx.baseline.fields)) {
    if (!stats.values || !stats.valueSamples) continue;
    const observed = current.values.get(path);
    if (!observed) continue;
    const known = new Set(Object.keys(stats.values));
    const novel = [...new Set(observed.map(String))].filter((v) => !known.has(v));
    if (novel.length === 0) continue;
    out.push({
      rule: 'behavioral.enum_value_changed',
      kind: 'STRUCTURAL',
      category: 'BEHAVIORAL',
      severity: 'MEDIUM',
      confidence: Math.min(0.9, 0.5 + Math.min(stats.valueSamples, 100) / 250),
      fingerprint: `behavioral.enum_value_changed|${path}|${novel.sort().join(',')}`,
      summary: `Field \`${path}\` has value(s) ${novel.map((v) => `\`${v}\``).join(', ')} outside the ${known.size} value(s) seen in ${stats.valueSamples} baseline samples`,
      evidence: { path, before: stats.values, after: novel, note: 'A new value outside the observed set; whether consumers accept it is unknown.' },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operational / statistical
// ---------------------------------------------------------------------------

function latencyRule(window: NormalizedObservation[], ctx: RuleContext): RuleFinding[] {
  const { baseline, config } = ctx;
  if (!baseline.latency) return [];
  const responded = window.filter((w) => w.statusCode !== null).map((w) => w.latencyMs);
  if (responded.length < config.window.minSamples) return [];
  const stats = latencyStats(responded);
  const threshold = Math.max(baseline.latency.p95 * config.latency.p95Factor, baseline.latency.p95 + config.latency.minDeltaMs);
  if (stats.p95 <= threshold) return [];
  const ratio = baseline.latency.p95 > 0 ? stats.p95 / baseline.latency.p95 : Infinity;
  return [
    {
      rule: 'operational.latency_regression',
      kind: 'STATISTICAL',
      category: 'OPERATIONAL',
      severity: ratio >= config.latency.p95Factor * 2 ? 'HIGH' : 'MEDIUM',
      confidence: Math.min(0.95, 0.5 + responded.length / (2 * config.window.size)),
      fingerprint: 'operational.latency_regression|p95',
      summary: `p95 latency over the last ${responded.length} responses is ${stats.p95}ms vs ${baseline.latency.p95}ms in the baseline (threshold ${Math.round(threshold)}ms)`,
      evidence: { before: baseline.latency, after: stats, threshold: Math.round(threshold), windowSize: responded.length },
    },
  ];
}

function rateRules(window: NormalizedObservation[], ctx: RuleContext): RuleFinding[] {
  const { baseline, config } = ctx;
  if (window.length < config.window.minSamples) return [];
  const n = window.length;
  const checks: Array<{ rule: RuleId; category: RuleCategory; label: string; baselineRate: number; test: (o: NormalizedObservation) => boolean }> = [
    { rule: 'operational.error_rate_increase', category: 'OPERATIONAL', label: 'non-success', baselineRate: baseline.rates.error, test: (o) => o.outcome !== 'SUCCESS' },
    { rule: 'availability.timeout_rate_increase', category: 'AVAILABILITY', label: 'timeout', baselineRate: baseline.rates.timeout, test: (o) => o.outcome === 'TIMEOUT' },
    { rule: 'availability.unavailable_rate_increase', category: 'AVAILABILITY', label: 'unavailable / no-response', baselineRate: baseline.rates.unavailable + baseline.rates.noResponse, test: (o) => o.outcome === 'UNAVAILABLE' || o.outcome === 'NETWORK_ERROR' || o.outcome === 'TIMEOUT' },
    { rule: 'rate_limit.rate_increase', category: 'RATE_LIMIT', label: 'rate-limited (429)', baselineRate: baseline.rates.rateLimited, test: (o) => o.outcome === 'RATE_LIMITED' },
  ];
  const out: RuleFinding[] = [];
  for (const c of checks) {
    const count = window.filter(c.test).length;
    const rate = count / n;
    if (count < config.rates.minCount) continue;
    if (rate - c.baselineRate < config.rates.minIncrease) continue;
    const severity: Severity = rate >= 0.5 ? 'HIGH' : 'MEDIUM';
    out.push({
      rule: c.rule,
      kind: 'STATISTICAL',
      category: c.category,
      severity: c.rule === 'operational.error_rate_increase' && rate >= 0.8 ? 'CRITICAL' : severity,
      confidence: Math.min(0.95, 0.5 + n / (2 * config.window.size)),
      fingerprint: `${c.rule}|window`,
      summary: `${pct(rate)} of the last ${n} observations were ${c.label} (baseline ${pct(c.baselineRate)}, threshold +${pct(config.rates.minIncrease)})`,
      evidence: { before: { rate: round2(c.baselineRate), samples: baseline.sampleCount }, after: { rate: round2(rate), count, windowSize: n }, threshold: config.rates },
    });
  }
  return out;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
