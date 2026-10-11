import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../src/config/env.js';

const valid = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(10_000); 
  });

  it('coerces numeric strings', () => {
    const env = parseEnv({ ...valid, PORT: '8080', DATABASE_POOL_MAX: '3' });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(3);
  });

  it('rejects a missing DATABASE_URL and lists the path', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    try {
      parseEnv({});
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const issues = (err as EnvValidationError).issues;
      expect(issues.some((i) => i.path === 'DATABASE_URL')).toBe(true);
    }
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/);
  });

  it('reports an invalid PORT and LOG_LEVEL together', () => {
    let caught: unknown;
    try {
      parseEnv({ ...valid, PORT: '99999', LOG_LEVEL: 'loud' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const paths = (caught as EnvValidationError).issues.map((i) => i.path).sort();
    expect(paths).toEqual(['LOG_LEVEL', 'PORT']);
  });

  it('allows TEST_DATABASE_URL to be absent or empty', () => {
    expect(parseEnv({ ...valid, TEST_DATABASE_URL: '' }).TEST_DATABASE_URL).toBe('');
    expect(parseEnv(valid).TEST_DATABASE_URL).toBeUndefined();
  });
});
