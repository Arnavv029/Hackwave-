import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger.js';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger({ level: 'debug', serviceName: 'test-svc', destination });
  return { logger, lines };
}

describe('createLogger', () => {
  it('emits JSON lines with service name and level label', () => {
    const { logger, lines } = captureLogger();
    logger.info({ a: 1 }, 'hello');
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['service']).toBe('test-svc');
    expect(parsed['level']).toBe('info');
    expect(parsed['msg']).toBe('hello');
    expect(parsed['a']).toBe(1);
  });

  it('redacts authorization and cookie headers on req objects', () => {
    const { logger, lines } = captureLogger();
    logger.info({
      req: { headers: { authorization: 'Bearer top-secret', cookie: 'sid=abc', 'x-api-key': 'k' } },
    });
    const line = lines[0] ?? '';
    expect(line).not.toContain('top-secret');
    expect(line).not.toContain('sid=abc');
    expect(line).toContain('[REDACTED]');
    const parsed = JSON.parse(line) as { req: { headers: Record<string, string> } };
    expect(parsed.req.headers['x-api-key']).toBe('[REDACTED]');
  });

  it('redacts secret-like keys nested at one level', () => {
    const { logger, lines } = captureLogger();
    logger.info({ provider: { apiKey: 'sk-live-123', token: 't', password: 'p', name: 'users' } });
    const line = lines[0] ?? '';
    expect(line).not.toContain('sk-live-123');
    const parsed = JSON.parse(line) as { provider: Record<string, string> };
    expect(parsed.provider['apiKey']).toBe('[REDACTED]');
    expect(parsed.provider['token']).toBe('[REDACTED]');
    expect(parsed.provider['password']).toBe('[REDACTED]');
    expect(parsed.provider['name']).toBe('users');
  });
});
