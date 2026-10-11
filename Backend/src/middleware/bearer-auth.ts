import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors.js';

/**
 * Minimal shared-secret authentication for operator/development endpoints.
 * Compares in constant time and never echoes the presented token.
 */
export function requireBearerToken(expected: string): RequestHandler {
  const expectedBuf = Buffer.from(expected, 'utf8');
  return (req, _res, next) => {
    const header = req.headers.authorization;
    const presented = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const presentedBuf = Buffer.from(presented, 'utf8');
    const ok = presentedBuf.length === expectedBuf.length && presentedBuf.length > 0 && timingSafeEqual(presentedBuf, expectedBuf);
    if (!ok) {
      next(new UnauthorizedError('A valid bearer token is required'));
      return;
    }
    next();
  };
}
