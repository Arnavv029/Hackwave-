import { describe, expect, it } from 'vitest';
import { checksumSpec } from '../../src/db/repositories/repair.repository.js';

describe('checksumSpec', () => {
  it('is independent of key order', () => {
    const a = checksumSpec({ map: { from: 'display_name', to: 'name' }, kind: 'FIELD_MAPPING' });
    const b = checksumSpec({ kind: 'FIELD_MAPPING', map: { to: 'name', from: 'display_name' } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when content changes', () => {
    expect(checksumSpec({ a: 1 })).not.toBe(checksumSpec({ a: 2 }));
    expect(checksumSpec([1, 2])).not.toBe(checksumSpec([2, 1]));
  });
});
