import { describe, expect, it } from 'vitest';
import { diffFingerprint, diffResponses, nameSimilarity } from '../../src/guardian/diff.js';
import { jsonPathExists, parseJsonPath, resolveJsonPath, toFlatPath } from '../../src/guardian/jsonpath.js';
import { applyAdapter, describeAdapter } from '../../src/guardian/adapter.js';
import { privateReason, checkUrl } from '../../src/guardian/ssrf.js';
import { SecretBox } from '../../src/guardian/secrets.js';
import { buildProposal, explainTransportError } from '../../src/guardian/engine.js';
import type { IncidentRecord, MappingRecord, MonitorRecord } from '../../src/guardian/store.js';

const baseline = { id: 104, name: 'Aman Gupta', email: 'aman@example.com', role: 'admin', status: 'active', address: { city: 'Pune', zip: '411001' }, items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] };

describe('diffResponses', () => {
  it('reports identical documents as identical regardless of key order and array length', () => {
    const reordered = { items: [{ qty: 2, sku: 'A' }], status: 'active', role: 'admin', email: 'aman@example.com', name: 'Aman Gupta', id: 104, address: { zip: '411001', city: 'Pune' } };
    const d = diffResponses(baseline, reordered);
    expect(d.identical).toBe(true);
    expect(d.breaking).toBe(false);
  });

  it('detects a rename when the value moved to a new key (name -> display_name)', () => {
    const { name, ...rest } = baseline;
    const d = diffResponses(baseline, { ...rest, display_name: name });
    expect(d.breaking).toBe(true);
    const r = d.changes.find((c) => c.changeType === 'renamed');
    expect(r?.path).toBe('name');
    expect(r?.newPath).toBe('display_name');
    expect(r?.evidence?.valueMatch).toBe(true);
    expect(d.counts.removed).toBe(0);
    expect(d.counts.added).toBe(0);
  });

  it('detects a rename with a dissimilar name when it is the only swap in the object (transaction_id -> payment_reference)', () => {
    const before = { transaction_id: 'txn_1', amount: 10, currency: 'USD' };
    const after = { payment_reference: 'txn_9', amount: 10, currency: 'USD' };
    const d = diffResponses(before, after);
    const r = d.changes.find((c) => c.changeType === 'renamed');
    expect(r?.path).toBe('transaction_id');
    expect(r?.newPath).toBe('payment_reference');
    expect(r?.evidence?.singleSwap).toBe(true);
  });

  it('does not pair a removed field with an added one of an incompatible type', () => {
    const d = diffResponses({ total: 10, a: 1 }, { total_label: 'ten', a: 1 });
    expect(d.counts.renamed).toBe(0);
    expect(d.counts.removed).toBe(1);
    expect(d.counts.added).toBe(1);
  });

  it('reports removed, added and type changes, including inside arrays', () => {
    const d = diffResponses(baseline, { id: '104', email: 'aman@example.com', role: 'admin', status: 'active', address: { city: 'Pune', zip: '411001' }, items: [{ sku: 'A' }], extra: true });
    const types = Object.fromEntries(d.changes.map((c) => [`${c.changeType}:${c.path}`, c]));
    expect(types['removed:name']).toBeDefined();
    expect(types['removed:items[].qty']).toBeDefined();
    expect(types['type_mismatch:id']).toBeDefined();
    expect(types['added:extra']).toBeDefined();
    expect(d.breaking).toBe(true);
  });

  it('treats additive-only changes as non-breaking and null as nullable rather than a type change', () => {
    const d = diffResponses(baseline, { ...baseline, nickname: 'AG', role: null });
    expect(d.breaking).toBe(false);
    expect(d.counts.added).toBe(1);
    expect(d.counts.type_mismatch).toBe(0);
  });

  it('folds a renamed container into one change instead of one per child', () => {
    const d = diffResponses({ user: { first: 'A', last: 'B' } }, { profile: { first: 'A', last: 'B' } });
    expect(d.changes.filter((c) => c.changeType === 'renamed')).toHaveLength(1);
    expect(d.changes.find((c) => c.changeType === 'renamed')?.newPath).toBe('profile');
    expect(d.changes.filter((c) => c.changeType === 'removed')).toHaveLength(0);
  });

  it('recognises a renamed container by its identical child structure (page envelope -> items)', () => {
    const rows = [{ order_id: 'o1', total: 1 }, { order_id: 'o2', total: 2 }];
    const d = diffResponses({ data: rows, page: { number: 1, size: 2, total: 9 } }, { items: rows, cursor: { next: 'abc', has_more: true } });
    const renamed = d.changes.filter((c) => c.changeType === 'renamed');
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({ path: 'data', newPath: 'items' });
    expect(renamed[0]?.evidence?.childOverlap).toBe(1);
    expect(d.changes.filter((c) => c.changeType === 'removed').map((c) => c.path)).toEqual(['page']);
    expect(d.changes.filter((c) => c.changeType === 'added').map((c) => c.path)).toEqual(['cursor']);
  });

  it('skips volatile fields for value changes and keeps value changes informational', () => {
    const d = diffResponses({ id: 1, updated_at: 'x', status: 'shipped' }, { id: 2, updated_at: 'y', status: 'in_transit' }, { volatileFields: ['id', '*_at'] });
    expect(d.breaking).toBe(false);
    expect(d.changes.map((c) => c.path)).toEqual(['status']);
    expect(d.changes[0]?.changeType).toBe('value_changed');
  });

  it('respects the rename threshold', () => {
    const before = { alpha: 'v', keep: 1, other: 2 };
    const after = { omega: 'w', keep: 1, other: 2, more: 3 };
    expect(diffResponses(before, after, { renameThreshold: 0.9 }).counts.renamed).toBe(0);
    expect(diffResponses(before, after, { renameThreshold: 0.2 }).counts.renamed).toBe(1);
  });

  it('produces a stable fingerprint independent of value changes', () => {
    const a = diffResponses(baseline, { ...baseline, name: undefined, display_name: 'X', status: 'inactive' });
    const b = diffResponses(baseline, { ...baseline, name: undefined, display_name: 'Y' });
    expect(diffFingerprint(a)).toBe(diffFingerprint(b));
  });

  it('name similarity handles case, separators and plurals', () => {
    expect(nameSimilarity('displayName', 'display_name')).toBe(1);
    expect(nameSimilarity('item', 'items')).toBe(1);
    expect(nameSimilarity('name', 'display_name')).toBeGreaterThan(0.4);
    expect(nameSimilarity('transaction_id', 'payment_reference')).toBeLessThan(0.3);
  });
});

describe('jsonpath', () => {
  it('parses and resolves the supported subset', () => {
    expect(toFlatPath('$.items[0].sku')).toBe('items[].sku');
    expect(toFlatPath("$['a'].b")).toBe('a.b');
    expect(resolveJsonPath(baseline, '$.items[].sku')).toEqual(['A', 'B']);
    expect(resolveJsonPath(baseline, 'address.city')).toEqual(['Pune']);
    expect(resolveJsonPath(baseline, '$.items[-1].qty')).toEqual([1]);
    expect(jsonPathExists(baseline, '$.missing')).toBe(false);
    expect(() => parseJsonPath('$.a[?(@.x)]')).toThrow(/unsupported/);
  });
});

describe('applyAdapter', () => {
  it('renames back to the baseline key, keeps the source and is deterministic', () => {
    const spec = { version: 1 as const, ops: [{ op: 'rename' as const, from: '$.display_name', to: '$.name', removeSource: false, onConflict: 'reject' as const }] };
    const input = { display_name: 'Aman', email: 'a@b' };
    const r1 = applyAdapter(spec, input);
    const r2 = applyAdapter(spec, input);
    expect(r1.ok).toBe(true);
    expect(r1.output).toEqual({ display_name: 'Aman', email: 'a@b', name: 'Aman' });
    expect(JSON.stringify(r1.output)).toBe(JSON.stringify(r2.output));
    expect(input).toEqual({ display_name: 'Aman', email: 'a@b' });
  });
  it('rejects conflicting values by default and can prefer a side', () => {
    const base = { from: '$.b', to: '$.a', removeSource: false };
    expect(applyAdapter({ version: 1, ops: [{ op: 'rename', ...base, onConflict: 'reject' }] }, { a: 1, b: 2 }).ok).toBe(false);
    expect(applyAdapter({ version: 1, ops: [{ op: 'rename', ...base, onConflict: 'prefer_source' }] }, { a: 1, b: 2 }).output).toEqual({ a: 2, b: 2 });
    expect(applyAdapter({ version: 1, ops: [{ op: 'rename', ...base, onConflict: 'keep_target' }] }, { a: 1, b: 2 }).output).toEqual({ a: 1, b: 2 });
  });
  it('works across array elements and coerces losslessly only', () => {
    const r = applyAdapter({ version: 1, ops: [{ op: 'rename', from: '$.items[].code', to: '$.items[].sku', removeSource: true, onConflict: 'reject' }, { op: 'coerce', path: '$.items[].qty', toType: 'number' }] }, { items: [{ code: 'A', qty: '2' }, { code: 'B', qty: '3' }] });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 3 }] });
    expect(applyAdapter({ version: 1, ops: [{ op: 'coerce', path: '$.qty', toType: 'number' }] }, { qty: 'two' }).ok).toBe(false);
  });
  it('renders a human description without code', () => {
    const text = describeAdapter({ version: 1, ops: [{ op: 'default', path: '$.currency', value: 'USD' }] });
    expect(text).toContain('default  currency');
    expect(text).not.toMatch(/function|eval|=>/);
  });
});

describe('ssrf guard', () => {
  it('classifies private ranges', () => {
    expect(privateReason('127.0.0.1')).toMatch(/loopback/);
    expect(privateReason('10.1.2.3')).toMatch(/10\/8/);
    expect(privateReason('169.254.169.254')).toMatch(/metadata/);
    expect(privateReason('172.20.0.1')).toMatch(/172\.16/);
    expect(privateReason('8.8.8.8')).toBeNull();
    expect(privateReason('::1')).toMatch(/loopback/);
  });
  it('blocks private destinations unless allowed and rejects bad schemes', async () => {
    const resolve = () => Promise.resolve(['10.0.0.5']);
    expect((await checkUrl('http://internal.corp/x', { allowPrivateNetworks: false, resolve })).blocked).toBe(true);
    expect((await checkUrl('http://internal.corp/x', { allowPrivateNetworks: true, resolve })).blocked).toBe(false);
    expect((await checkUrl('http://localhost:3000/mock', { allowPrivateNetworks: false, resolve: () => Promise.resolve(['127.0.0.1']) })).blocked).toBe(true);
    await expect(checkUrl('ftp://example.com', { allowPrivateNetworks: true })).rejects.toThrow(/http/);
    await expect(checkUrl('http://user:pw@example.com', { allowPrivateNetworks: true, resolve: () => Promise.resolve(['1.1.1.1']) })).rejects.toThrow(/Credentials/);
  });
});

describe('SecretBox', () => {
  it('round-trips and rejects tampering', () => {
    const box = new SecretBox('a-passphrase-of-sufficient-length');
    const enc = box.encrypt('sk-very-secret');
    expect(enc).not.toContain('sk-very-secret');
    expect(box.decrypt(enc)).toBe('sk-very-secret');
    expect(() => box.decrypt(enc.slice(0, -4) + 'AAAA')).toThrow();
    expect(() => new SecretBox('short')).toThrow();
  });
});

describe('buildProposal', () => {
  const monitor = { id: 'm1', name: 'User API', environment: 'Production' } as MonitorRecord;
  const incident = { id: 'i1' } as IncidentRecord;
  const mapping = { id: 'mp', monitorId: 'm1', feature: 'Profile card', jsonPath: '$.name', route: '/profile', impactLevel: 'Critical', description: null, symptom: null, createdBy: 'x', createdAt: new Date() } as MappingRecord;
  it('derives a rename adapter with evidence-based assumptions and mapping risks', () => {
    const d = diffResponses({ name: 'A', email: 'e' }, { display_name: 'A', email: 'e' });
    const p = buildProposal(monitor, incident, d, [mapping], 'system');
    expect(p.transform.ops).toEqual([{ op: 'rename', from: '$.display_name', to: '$.name', removeSource: false, onConflict: 'reject' }]);
    expect(p.requiresManualReview).toBe(false);
    expect(p.assumptions[0]).toMatch(/display_name/);
    expect(p.risks.some((r) => r.includes('Profile card'))).toBe(true);
    expect(p.targetEnvironment).toBe('Staging');
  });
  it('flags manual review when a field disappears without a candidate', () => {
    const d = diffResponses({ name: 'A', email: 'e' }, { email: 'e' });
    const p = buildProposal(monitor, incident, d, [], 'system');
    expect(p.transform.ops).toHaveLength(0);
    expect(p.requiresManualReview).toBe(true);
    expect(p.proposedSolution).toMatch(/No safe automatic mapping/);
  });
  it('does not auto-rename a container whose inner fields changed too', () => {
    const d = diffResponses({ coords: { lat: 1, lng: 2 }, id: 'x' }, { coordinates: { latitude: 1, longitude: 2 }, id: 'x' });
    const p = buildProposal(monitor, incident, d, [], 'system');
    expect(p.requiresManualReview).toBe(true);
    expect(p.transform.ops).toHaveLength(0);
    expect(p.assumptions.join(' ')).toMatch(/inner fields differ/);
  });
  it('derives a coerce op for lossless type changes', () => {
    const d = diffResponses({ amount: 10 }, { amount: '10' });
    const p = buildProposal(monitor, incident, d, [], 'system');
    expect(p.transform.ops).toEqual([{ op: 'coerce', path: '$.amount', toType: 'number' }]);
  });
});

describe('explainTransportError', () => {
  it('explains an https URL against a plain-http server', () => {
    const msg = explainTransportError('fetch failed: 40090D47B77F0000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number:../deps/openssl/ssl/record/methods/tlsany_meth.c:77:\n', 'https://127.0.0.1:3000/mock/demo/status/html');
    expect(msg).toMatch(/plain HTTP on an https:\/\/ URL/);
    expect(msg).toMatch(/Use http:\/\//);
    expect(msg).toContain('127.0.0.1:3000');
  });
  it('explains refused connections and unknown hosts, and passes other messages through', () => {
    expect(explainTransportError('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:9', 'http://127.0.0.1:9/x')).toMatch(/nothing is listening/);
    expect(explainTransportError('ENOTFOUND: getaddrinfo ENOTFOUND nope.invalid', 'https://nope.invalid/')).toMatch(/does not resolve/);
    expect(explainTransportError('something odd', 'http://a/')).toBe('something odd');
  });
});
