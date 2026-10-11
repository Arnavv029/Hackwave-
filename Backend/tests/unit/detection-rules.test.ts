import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveDetectionConfig, isVolatile, type DetectionConfig } from '../../src/detection/config.js';
import { nameSimilarity, runRules, type RuleFinding } from '../../src/detection/rules.js';
import { buildBaselineSummary, InsufficientSamplesError, type BaselineSummary } from '../../src/detection/summary.js';
import { normalizeObservation } from '../../src/detection/normalize.js';
import { compareSummaries } from '../../src/detection/compare.js';
import { extractFieldPaths, hashFieldPaths } from '../../src/observation/shape.js';
import type { StoredObservation } from '../../src/observation/store.js';

/** Build a stored observation from a JSON body (or a failure) without the HTTP stack. */
function obs(body: unknown, o: Partial<StoredObservation> & { at?: number } = {}): StoredObservation {
  const fieldPaths = body === undefined ? null : extractFieldPaths(body);
  const status = o.statusCode === undefined ? 200 : o.statusCode;
  const outcome = o.outcome ?? (status === null ? 'TIMEOUT' : status === 429 ? 'RATE_LIMITED' : status === 503 ? 'UNAVAILABLE' : status >= 400 ? 'HTTP_ERROR' : 'SUCCESS');
  return {
    id: randomUUID(),
    nodeId: 'payments:POST:/charges',
    createdAt: new Date(),
    providerKey: 'payments',
    endpointKey: 'POST /charges',
    method: 'POST',
    observedAt: new Date(1_760_000_000_000 + (o.at ?? 0) * 1_000),
    latencyMs: o.latencyMs ?? 50,
    outcome,
    errorCategory: outcome === 'SUCCESS' ? null : outcome === 'TIMEOUT' ? 'TIMEOUT' : outcome === 'RATE_LIMITED' ? 'RATE_LIMITED' : outcome === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'HTTP_ERROR',
    statusCode: status,
    parseOutcome: body === undefined ? 'NOT_READ' : 'JSON',
    responseBytes: 100,
    correlationId: null,
    scenario: null,
    requestMeta: { method: 'POST', path: '/mock/payments/charges', queryKeys: [], headerNames: [], redactedHeaders: [], bodyBytes: 0, timeoutMs: 1000, maxResponseBytes: 1000 },
    responseHeaders: { kept: {}, redacted: [], omitted: [] },
    fieldPaths,
    shapeHash: fieldPaths ? hashFieldPaths(fieldPaths) : null,
    shapeDelta: null,
    responseSample: body ?? null,
    contractCheck: { checked: false, valid: null, issues: [], issueCount: 0 },
    errorMessage: null,
    ...o,
  };
}

const charge = (i: number, extra: Record<string, unknown> = {}) => ({
  transaction_id: `txn_${i}`,
  amount: 1000 + i,
  currency: i % 3 === 0 ? 'EUR' : 'USD',
  status: 'succeeded',
  created_at: new Date(1_760_000_000_000 + i).toISOString(),
  ...extra,
});

const cfg = resolveDetectionConfig({ minSamplesForBaseline: 5, window: { size: 10, minSamples: 5 }, enumMinSamples: 5 });
const baselineObs = Array.from({ length: 20 }, (_, i) => obs(charge(i), { at: i, latencyMs: 40 + (i % 5) * 5 }));
const baseline = buildBaselineSummary({ providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', observations: baselineObs, config: cfg });

function detect(current: StoredObservation, recent: StoredObservation[] = [], config: DetectionConfig = cfg, summary: BaselineSummary = baseline): RuleFinding[] {
  return runRules({ observation: current, baseline: summary, window: [current, ...recent], config });
}
const rules = (f: RuleFinding[]) => f.map((x) => x.rule);

describe('normalization and summary', () => {
  it('ignores key order, merges arrays and drops volatile values', () => {
    const a = normalizeObservation(obs({ b: 1, a: { y: [1, 2], x: 's' }, created_at: 't1' }), cfg);
    const b = normalizeObservation(obs({ a: { x: 's', y: [3] }, created_at: 't2', b: 1 }), cfg);
    expect([...a.fields!.keys()]).toEqual([...b.fields!.keys()]);
    expect(a.shapeHash).toBe(b.shapeHash);
    expect(a.values.has('created_at')).toBe(false);
    expect(a.values.get('a.y[]')).toEqual([1, 2]);
    expect(isVolatile('data[].shipment_id', cfg)).toBe(true);
    expect(isVolatile('data[].carrier', cfg)).toBe(false);
  });

  it('describes presence, types, null rate, enum-like values, statuses, rates and latency', () => {
    expect(baseline.sampleCount).toBe(20);
    expect(baseline.fields['transaction_id']).toMatchObject({ presence: 1, types: ['string'], nullRate: 0 });
    expect(baseline.fields['currency']?.values).toEqual({ EUR: 7, USD: 13 });
    expect(baseline.fields['amount']?.values).toBeUndefined(); // 20 distinct values > enumMaxCardinality
    expect(baseline.fields['transaction_id']?.values).toBeUndefined(); // volatile (*_id)
    expect(baseline.statusCodes).toEqual({ '200': 20 });
    expect(baseline.rates.error).toBe(0);
    expect(baseline.latency?.p95).toBe(60);
    expect(Object.keys(baseline.shapeHashes)).toHaveLength(1);
  });

  it('refuses to build from too few samples and tracks nullability', () => {
    expect(() => buildBaselineSummary({ providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', observations: baselineObs.slice(0, 3), config: cfg })).toThrow(InsufficientSamplesError);
    const nullable = buildBaselineSummary({
      providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', config: cfg,
      observations: Array.from({ length: 6 }, (_, i) => obs(charge(i, { note: i % 2 ? null : 'x' }), { at: i })),
    });
    expect(nullable.fields['note']).toMatchObject({ presence: 1, types: ['string'], nullRate: 0.5 });
  });
});

describe('structural rules', () => {
  it('is silent for a conforming observation and for noisy-but-known variation', () => {
    expect(detect(obs(charge(99)))).toEqual([]);
    expect(detect(obs(charge(100, { currency: 'EUR' })))).toEqual([]);
  });

  it('reports removed and added fields and a rename candidate, without suppressing either', () => {
    const { transaction_id: _t, ...rest } = charge(1);
    const f = detect(obs({ payment_reference: 'txn_1', ...rest }));
    expect(rules(f)).toEqual(['structural.field_removed', 'structural.rename_candidate', 'structural.field_added']);
    const removed = f[0]!;
    expect(removed.severity).toBe('HIGH');
    expect(removed.fingerprint).toBe('structural.field_removed|transaction_id');
    const rename = f[1]!;
    expect(rename.evidence).toMatchObject({ from: 'transaction_id', to: 'payment_reference', typeCompatible: true, reasons: ['single_swap'] });
    expect(rename.confidence).toBeLessThan(0.5);
    expect(rename.summary).toMatch(/candidate only/);
    expect(f[2]!.severity).toBe('LOW');
    expect(f[2]!.summary).toMatch(/not assumed breaking/);
  });

  it('does not propose a rename when types are incompatible, or when several fields change at once with unrelated names', () => {
    const { transaction_id: _t, ...rest } = charge(1);
    expect(rules(detect(obs({ txn_count: 5, ...rest })))).not.toContain('structural.rename_candidate');
    const { currency: _c, ...rest2 } = rest;
    // Two removed, two added, no name similarity: ambiguous, so no candidate.
    expect(rules(detect(obs({ zebra: 'txn_1', giraffe: 'XXX', ...rest2 })))).not.toContain('structural.rename_candidate');
    // Similar names are a candidate even among several changes.
    const f = detect(obs({ zebra: 'txn_1', currency_code: 'XXX', ...rest2 }));
    expect(f.filter((x) => x.rule === 'structural.rename_candidate').map((x) => x.evidence['to'])).toEqual(['currency_code']);
    expect(nameSimilarity('transaction_id', 'payment_reference')).toBeLessThan(0.5);
    expect(nameSimilarity('name', 'display_name')).toBeGreaterThanOrEqual(0.5);
  });

  it('reports type and nullability changes', () => {
    const f = detect(obs(charge(1, { amount: '1000', status: null })));
    expect(rules(f)).toEqual(['structural.type_changed', 'structural.nullability_changed']);
    expect(f[0]!.evidence).toMatchObject({ path: 'amount', before: { types: ['number'] }, after: { types: ['string'] } });
    expect(f[1]!.evidence).toMatchObject({ path: 'status' });
  });

  it('ignores optional baseline fields that go missing and children of a missing parent', () => {
    const withOptional = buildBaselineSummary({
      providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', config: cfg,
      observations: Array.from({ length: 10 }, (_, i) => obs(charge(i, i < 5 ? { coupon: { code: 'X', pct: 5 } } : {}), { at: i })),
    });
    expect(detect(obs(charge(1)), [], cfg, withOptional)).toEqual([]);
    const { transaction_id: _t, ...rest } = charge(1);
    const nested = buildBaselineSummary({
      providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', config: cfg,
      observations: Array.from({ length: 6 }, (_, i) => obs(charge(i, { meta: { a: 1, b: 2 } }), { at: i })),
    });
    const f = detect(obs({ transaction_id: 't', ...rest }), [], cfg, nested);
    expect(f.map((x) => x.fingerprint)).toEqual(['structural.field_removed|meta']);
  });

  it('raises confidence when the change recurs across the window', () => {
    const { transaction_id: _t, ...rest } = charge(1);
    const changed = () => obs({ payment_reference: 'x', ...rest });
    const once = detect(changed(), [obs(charge(2)), obs(charge(3)), obs(charge(4))]);
    const persistent = detect(changed(), [changed(), changed(), changed()]);
    const c = (f: RuleFinding[]) => f.find((x) => x.rule === 'structural.field_removed')!.confidence;
    expect(c(persistent)).toBeGreaterThan(c(once));
    expect(once[0]!.evidence).toMatchObject({ window: { matching: 1, of: 4 } });
  });
});

describe('behavioural rules', () => {
  it('flags a status never seen in the baseline, with severity by class', () => {
    expect(detect(obs({ error: { code: 'x' } }, { statusCode: 500 }))[0]).toMatchObject({ rule: 'behavioral.status_changed', severity: 'HIGH', category: 'BEHAVIORAL' });
    expect(detect(obs({ error: {} }, { statusCode: 429 }))[0]).toMatchObject({ rule: 'behavioral.status_changed', severity: 'MEDIUM', category: 'RATE_LIMIT' });
    expect(detect(obs(undefined, { statusCode: null, outcome: 'TIMEOUT' }))[0]).toMatchObject({ rule: 'behavioral.status_changed', category: 'AVAILABILITY', fingerprint: 'behavioral.status_changed|none' });
    expect(detect(obs(charge(1), { statusCode: 201 }))[0]).toMatchObject({ rule: 'behavioral.status_changed', severity: 'LOW' });
  });

  it('flags a value outside an enum-like set but never for high-cardinality or volatile fields', () => {
    const f = detect(obs(charge(1, { currency: 'GBP', amount: 999_999, transaction_id: 'txn_new' })));
    expect(rules(f)).toEqual(['behavioral.enum_value_changed']);
    expect(f[0]!.evidence).toMatchObject({ path: 'currency', after: ['GBP'] });
    expect(f[0]!.summary).toMatch(/outside the 2 value/);
  });
});

describe('statistical rules: thresholds and minimum samples', () => {
  const recentOk = Array.from({ length: 9 }, (_, i) => obs(charge(50 + i), { at: 100 + i }));

  it('stays silent on an isolated failure and below the minimum window size', () => {
    const one = detect(obs(undefined, { statusCode: null, outcome: 'TIMEOUT' }), recentOk);
    expect(rules(one)).toEqual(['behavioral.status_changed']);
    const few = detect(obs(undefined, { statusCode: null, outcome: 'TIMEOUT' }), [obs(undefined, { statusCode: null, outcome: 'TIMEOUT' })]);
    expect(rules(few)).toEqual(['behavioral.status_changed']);
  });

  it('reports a timeout / error rate increase once the window crosses the thresholds', () => {
    const flaky = [...recentOk.slice(0, 5), ...Array.from({ length: 4 }, () => obs(undefined, { statusCode: null, outcome: 'TIMEOUT' }))];
    const f = detect(obs(undefined, { statusCode: null, outcome: 'TIMEOUT' }), flaky);
    expect(rules(f)).toEqual(expect.arrayContaining(['operational.error_rate_increase', 'availability.timeout_rate_increase', 'availability.unavailable_rate_increase']));
    const err = f.find((x) => x.rule === 'operational.error_rate_increase')!;
    expect(err.kind).toBe('STATISTICAL');
    expect(err.severity).toBe('HIGH');
    expect(err.evidence).toMatchObject({ before: { rate: 0 }, after: { count: 5, windowSize: 10 } });
    expect(rules(f)).not.toContain('rate_limit.rate_increase');
  });

  it('tolerates intermittent failures that the baseline already contained', () => {
    const noisyBaseline = buildBaselineSummary({
      providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', config: cfg,
      observations: Array.from({ length: 20 }, (_, i) => (i % 4 === 0 ? obs({ error: {} }, { statusCode: 503, at: i }) : obs(charge(i), { at: i }))),
    });
    expect(noisyBaseline.rates.unavailable).toBe(0.25);
    const window = Array.from({ length: 9 }, (_, i) => (i % 3 === 0 ? obs({ error: {} }, { statusCode: 503 }) : obs(charge(i))));
    const f = detect(obs({ error: {} }, { statusCode: 503 }), window, cfg, noisyBaseline);
    expect(f).toEqual([]); // 40% vs 25% baseline: below the +20% threshold, and 503 is a known status
  });

  it('reports a 429 rate increase separately', () => {
    const limited = Array.from({ length: 9 }, (_, i) => (i < 4 ? obs({ error: {} }, { statusCode: 429 }) : obs(charge(i))));
    const f = detect(obs({ error: {} }, { statusCode: 429 }), limited);
    expect(rules(f)).toContain('rate_limit.rate_increase');
    expect(f.find((x) => x.rule === 'rate_limit.rate_increase')!.category).toBe('RATE_LIMIT');
  });

  it('reports a latency regression only beyond factor and absolute delta, with enough samples', () => {
    const slow = (n: number) => Array.from({ length: n }, (_, i) => obs(charge(70 + i), { latencyMs: 400 }));
    const f = detect(obs(charge(1), { latencyMs: 400 }), slow(9));
    expect(rules(f)).toEqual(['operational.latency_regression']);
    expect(f[0]!.evidence).toMatchObject({ before: { p95: 60 }, after: { p95: 400 }, threshold: 160 });
    expect(rules(detect(obs(charge(1), { latencyMs: 400 }), slow(2)))).toEqual([]);
    const mild = Array.from({ length: 9 }, (_, i) => obs(charge(80 + i), { latencyMs: 100 }));
    expect(rules(detect(obs(charge(1), { latencyMs: 100 }), mild))).toEqual([]); // 100 < max(60*2, 60+100)
    const strict = resolveDetectionConfig({ window: { size: 10, minSamples: 5 }, latency: { p95Factor: 1.2, minDeltaMs: 10 } });
    expect(rules(detect(obs(charge(1), { latencyMs: 100 }), mild, strict))).toEqual(['operational.latency_regression']);
  });
});

describe('compareSummaries', () => {
  it('produces a before/after report between two baseline versions', () => {
    const { transaction_id: _t, ...rest } = charge(0);
    const after = buildBaselineSummary({
      providerKey: 'payments', endpointKey: 'POST /charges', method: 'POST', contextKey: '', config: cfg,
      observations: Array.from({ length: 10 }, (_, i) => obs({ payment_reference: `p${i}`, ...rest, currency: 'GBP', amount: 1 }, { at: 200 + i, latencyMs: 300 })),
    });
    const report = compareSummaries({ id: 'a', version: 1, summary: baseline }, { id: 'b', version: 2, summary: after });
    expect(report.fields.removed.map((x) => x.path)).toEqual(['transaction_id']);
    expect(report.fields.added.map((x) => x.path)).toEqual(['payment_reference']);
    expect(report.fields.valuesChanged).toContainEqual({ path: 'currency', added: ['GBP'], removed: ['EUR', 'USD'] });
    expect(report.latency.p95Delta).toBe(240);
    expect(report.statusCodes).toMatchObject({ added: [], removed: [] });
  });
});
