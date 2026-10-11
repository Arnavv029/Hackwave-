import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { RequestHandler } from 'express';
import type { Logger } from '../logger.js';

/**
 * Per-request logging. Only a safe subset of the request is serialized:
 * headers are deliberately not logged at all, so credentials never reach the
 * log pipeline. The logger's redact list is a second line of defence.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method ?? ''} ${req.url ?? ''} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method ?? ''} ${req.url ?? ''} ${res.statusCode}`,
    serializers: {
      req: (req: { id?: unknown; method?: string; url?: string; remoteAddress?: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/health/live',
    },
  });
}
