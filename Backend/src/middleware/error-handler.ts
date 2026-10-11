import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../logger.js';
import { HttpError, NotFoundError, type ErrorCode, type ErrorResponseBody } from '../errors.js';
import { isPrismaKnownRequestError, isPrismaValidationError, uniqueViolationInfo } from '../db/errors.js';

export interface ErrorHandlerOptions {
  logger: Logger;
  /** When true, 5xx responses hide internal error messages. */
  exposeInternalErrors: boolean;
}

interface Normalized {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Map any thrown value to a status/code/message triple. */
export function normalizeError(err: unknown, exposeInternalErrors: boolean): Normalized {
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
    };
  }
  // Express's body parsers throw errors with a `status`/`type`.
  if (isBodyParserError(err)) {
    return { status: err.status, code: 'BAD_REQUEST', message: err.message };
  }
  if (isPrismaKnownRequestError(err)) {
    switch (err.code) {
      case 'P2002':
        return {
          status: 409,
          code: 'CONFLICT',
          message: 'Unique constraint violated',
          details: uniqueViolationInfo(err) ?? undefined,
        };
      case 'P2025':
        return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
      case 'P2003':
        return { status: 422, code: 'UNPROCESSABLE', message: 'Related record not found' };
      default:
        break;
    }
  }
  if (isPrismaValidationError(err)) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid database query' };
  }
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: exposeInternalErrors && err instanceof Error ? err.message : 'Internal server error',
  };
}

function isBodyParserError(err: unknown): err is Error & { status: number; type: string } {
  if (!(err instanceof Error)) return false;
  const { status, type } = err as Error & { status?: unknown; type?: unknown };
  return typeof status === 'number' && typeof type === 'string' && status >= 400 && status < 500;
}

export function createErrorHandler(options: ErrorHandlerOptions): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const normalized = normalizeError(err, options.exposeInternalErrors);
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    const log = req.log ?? options.logger;

    if (normalized.status >= 500) {
      log.error({ err, requestId, status: normalized.status }, 'request failed');
    } else {
      log.warn({ requestId, status: normalized.status, code: normalized.code }, normalized.message);
    }

    const body: ErrorResponseBody = {
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(normalized.status).json(body);
  };
}

/** Terminal middleware: anything that reaches it is a 404. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
};
