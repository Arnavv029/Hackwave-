import { describe, expect, it } from 'vitest';
import { boundedSample, diffFieldPaths, extractFieldPaths, hashFieldPaths } from '../../src/observation/shape.js';
import { MAX_FIELD_PATHS } from '../../src/observation/schemas.js';

describe('extractFieldPaths', () => {
  it('flattens nested objects and merges array elements', () => {
    const paths = extractFieldPaths({
      data: [
        { id: 'a', tags: ['x'], meta: { n: 1 } },
        { id: 'b', tags: [], meta: { n: null } },
      ],
      page: { number: 1 },
    });
    expect(paths).toEqual([
      { path: 'data', type: 'array' },
      { path: 'data[]', type: 'object' },
      { path: 'data[].id', type: 'string' },
      { path: 'data[].meta', type: 'object' },
      { path: 'data[].meta.n', type: 'null' },
      { path: 'data[].meta.n', type: 'number' },
      { path: 'data[].tags', type: 'array' },
      { path: 'data[].tags[]', type: 'string' },
      { path: 'page', type: 'object' },
      { path: 'page.number', type: 'number' },
    ]);
  });

  it('caps the number of paths', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 1_000; i += 1) wide[`f${i}`] = i;
    expect(extractFieldPaths(wide)).toHaveLength(MAX_FIELD_PATHS);
  });

  it('hashes independently of key order and array length', () => {
    const a = hashFieldPaths(extractFieldPaths({ a: 1, b: [1, 2, 3] }));
    const b = hashFieldPaths(extractFieldPaths({ b: [9], a: 2 }));
    expect(a).toBe(b);
    expect(a).not.toBe(hashFieldPaths(extractFieldPaths({ a: '1', b: [1] })));
  });
});

describe('diffFieldPaths', () => {
  it('reports added, removed and type-changed paths without judging them', () => {
    const before = extractFieldPaths({ transaction_id: 't', amount: 1, status: 's' });
    const after = extractFieldPaths({ payment_reference: 't', amount: '1', status: 's', extra: true });
    const delta = diffFieldPaths(before, after, '00000000-0000-7000-8000-000000000000');
    expect(delta.added).toEqual(['extra', 'payment_reference']);
    expect(delta.removed).toEqual(['transaction_id']);
    expect(delta.typeChanged).toEqual([{ path: 'amount', from: 'number', to: 'string' }]);
    expect(delta.unchanged).toBe(1);
  });
});

describe('boundedSample', () => {
  it('truncates arrays, strings and depth while preserving observed values', () => {
    const sample = boundedSample({
      amount: -50,
      items: Array.from({ length: 20 }, (_, i) => i),
      long: 'x'.repeat(1_000),
      token: 'secret',
    }) as Record<string, unknown>;
    expect(sample['amount']).toBe(-50);
    expect((sample['items'] as unknown[]).length).toBe(6);
    expect((sample['long'] as string).length).toBeLessThan(300);
    expect(sample['token']).toBe('[REDACTED]');
  });

  it('replaces oversized documents with a marker instead of storing them', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) big[`k${i}`] = 'y'.repeat(250);
    const sample = boundedSample(big) as Record<string, unknown>;
    expect(sample['__truncated']).toBe(true);
    expect(JSON.stringify(sample).length).toBeLessThan(2_000);
  });
});
