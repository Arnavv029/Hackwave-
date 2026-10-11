import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../setup/app.js';
import type { HealthBody, ReadinessBody } from '../../src/routes/health.js';
import type { ErrorResponseBody } from '../../src/errors.js';

function buildApp(overrides: { checkDatabase?: () => Promise<void>; nodeEnv?: 'production' | 'test' } = {}) {
  const { app, lines } = buildTestApp(overrides);
  return { app, lines };
}

describe('health endpoints', () => {
  it('GET /health returns liveness info without touching the database', async () => {
    const { app } = buildApp({ checkDatabase: () => Promise.reject(new Error('should not be called')) });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    const body = res.body as HealthBody;
    expect(body).toMatchObject({ status: 'ok', service: 'test', version: '0.0.0-test' });
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /health/ready returns 200 when the database answers', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    const body = res.body as ReadinessBody;
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('up');
  });

  it('GET /health/ready returns 503 when the database check fails', async () => {
    const { app } = buildApp({ checkDatabase: () => Promise.reject(new Error('connection refused')) });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    const body = res.body as ReadinessBody;
    expect(body.status).toBe('not_ready');
    expect(body.checks.database).toMatchObject({ status: 'down', error: 'connection refused' });
  });
});

describe('error handling', () => {
  it('returns a structured 404 for unknown routes with a request id', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/nope').set('x-request-id', 'req-123');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found', requestId: 'req-123' },
    });
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/health')
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect((res.body as ErrorResponseBody).error.code).toBe('BAD_REQUEST');
  });

  it('does not log request headers, so credentials never reach the log', async () => {
    const { app, lines } = buildApp();
    await request(app).get('/nope').set('authorization', 'Bearer super-secret-token');
    const output = lines.join('');
    expect(output).not.toContain('super-secret-token');
    expect(output).toContain('"statusCode":404');
  });
});
