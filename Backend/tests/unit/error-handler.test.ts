import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeError } from '../../src/middleware/error-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors.js';
import { Prisma } from '../../src/generated/prisma/client.js';

describe('normalizeError', () => {
  it('passes HttpError subclasses through', () => {
    expect(normalizeError(new NotFoundError('gone'), true)).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'gone' });
    expect(normalizeError(new ConflictError(), true)).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(normalizeError(new ValidationError('bad', [{ x: 1 }]), true)).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [{ x: 1 }],
    });
  });

  it('maps ZodError to 400 with flattened issue paths', () => {
    const result = z.object({ name: z.string(), nested: z.object({ n: z.number() }) }).safeParse({ nested: { n: 'x' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const normalized = normalizeError(result.error, true);
    expect(normalized.status).toBe(400);
    expect(normalized.code).toBe('VALIDATION_ERROR');
    const paths = (normalized.details as Array<{ path: string }>).map((d) => d.path).sort();
    expect(paths).toEqual(['name', 'nested.n']);
  });

  it('maps Prisma unique violations to 409 and missing records to 404', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['key'] },
    });
    expect(normalizeError(unique, true)).toMatchObject({ status: 409, code: 'CONFLICT' });

    const missing = new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: 'test' });
    expect(normalizeError(missing, true)).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('hides internal error messages when not exposing them', () => {
    const err = new Error('database password is hunter2');
    expect(normalizeError(err, false)).toEqual({ status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(normalizeError(err, true).message).toBe('database password is hunter2');
  });

  it('treats unknown throwables as 500', () => {
    expect(normalizeError('boom', true)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });
});
