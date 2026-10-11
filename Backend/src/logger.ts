import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Paths that are always redacted from log output. Covers request headers that
 * carry credentials and common secret-bearing property names at any depth.
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.accessToken',
  '*.refreshToken',
  '*.clientSecret',
  '*.DATABASE_URL',
];

export interface CreateLoggerOptions {
  level: LoggerOptions['level'];
  serviceName: string;
  /** Pretty-print for local development; JSON otherwise. */
  pretty?: boolean;
  /** Override the destination stream (used by tests). */
  destination?: pino.DestinationStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const base: LoggerOptions = {
    level: options.level,
    base: { service: options.serviceName },
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (options.destination) {
    return pino(base, options.destination);
  }
  if (options.pretty) {
    return pino({
      ...base,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
    });
  }
  return pino(base);
}

export type { Logger };
