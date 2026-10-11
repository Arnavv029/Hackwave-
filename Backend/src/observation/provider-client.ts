import type { HttpMethod } from '../providers/contracts.js';

/**
 * Thin HTTP client for calling providers under observation. Design rules:
 * - every request has a hard timeout (AbortSignal);
 * - the response body is read through a byte cap and aborted when exceeded;
 * - it NEVER retries; retry policy is a later-phase repair, not a client default;
 * - it never throws for provider behaviour: failures are returned as data so
 *   the engine can record them.
 */

export interface ProviderRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** JSON-serialisable body; serialised with `JSON.stringify`. */
  body?: unknown;
  timeoutMs: number;
  maxResponseBytes: number;
}

export type TransportFailureCategory = 'TIMEOUT' | 'CONNECTION_ERROR' | 'RESPONSE_TOO_LARGE' | 'UNKNOWN';

export interface ProviderCallResult {
  /** Null when no HTTP response (status line) was received. */
  status: number | null;
  /** Lower-cased header name -> value; empty when no response was received. */
  headers: Array<[string, string]>;
  /** Decoded body text (possibly partial when `truncated`). */
  bodyText: string;
  bodyBytes: number;
  truncated: boolean;
  latencyMs: number;
  failure: { category: TransportFailureCategory; message: string } | null;
  /** Bytes sent in the request body. */
  requestBytes: number;
}

export interface ProviderClientOptions {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class ProviderClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: ProviderClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? 'driftguard-observer/0.2';
  }

  async call(req: ProviderRequest): Promise<ProviderCallResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TimeoutError(req.timeoutMs)), req.timeoutMs);
    const started = performance.now();
    const latency = (): number => Math.max(0, Math.round(performance.now() - started));

    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': this.userAgent, ...req.headers };
    let payload: string | undefined;
    if (req.body !== undefined && req.method !== 'GET') {
      payload = JSON.stringify(req.body);
      headers['content-type'] ??= 'application/json';
    }
    const requestBytes = payload ? Buffer.byteLength(payload) : 0;

    let response: Response;
    try {
      response = await this.fetchImpl(req.url, {
        method: req.method,
        headers,
        body: payload,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (err) {
      clearTimeout(timer);
      return {
        status: null,
        headers: [],
        bodyText: '',
        bodyBytes: 0,
        truncated: false,
        latencyMs: latency(),
        failure: classifyFetchError(err, controller.signal),
        requestBytes,
      };
    }

    const headerPairs: Array<[string, string]> = [];
    response.headers.forEach((value, key) => headerPairs.push([key.toLowerCase(), value]));

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > req.maxResponseBytes) {
      clearTimeout(timer);
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      return {
        status: response.status,
        headers: headerPairs,
        bodyText: '',
        bodyBytes: 0,
        truncated: true,
        latencyMs: latency(),
        failure: { category: 'RESPONSE_TOO_LARGE', message: `content-length ${declared} exceeds limit ${req.maxResponseBytes}` },
        requestBytes,
      };
    }

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;
    let failure: ProviderCallResult['failure'] = null;
    try {
      if (response.body) {
        const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const value = chunk.value;
          if (!value) continue;
          bytes += value.byteLength;
          if (bytes > req.maxResponseBytes) {
            truncated = true;
            failure = { category: 'RESPONSE_TOO_LARGE', message: `body exceeded ${req.maxResponseBytes} bytes` };
            await reader.cancel().catch(() => undefined);
            controller.abort();
            break;
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      failure = classifyFetchError(err, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    const bodyText = truncated ? '' : Buffer.concat(chunks).toString('utf8');
    return {
      status: response.status,
      headers: headerPairs,
      bodyText,
      bodyBytes: truncated ? req.maxResponseBytes : bytes,
      truncated,
      latencyMs: latency(),
      failure,
      requestBytes,
    };
  }
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`request timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function classifyFetchError(err: unknown, signal: AbortSignal): { category: TransportFailureCategory; message: string } {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    if (reason instanceof TimeoutError) return { category: 'TIMEOUT', message: reason.message };
    return { category: 'TIMEOUT', message: 'request aborted' };
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return { category: 'TIMEOUT', message: err.message };
  }
  const code = errorCode(err);
  if (code && CONNECTION_CODES.has(code)) return { category: 'CONNECTION_ERROR', message: `${code}: ${describe(err)}` };
  if (err instanceof TypeError && /fetch failed|network|socket|ECONN|terminated|other side closed/i.test(describe(err))) {
    return { category: 'CONNECTION_ERROR', message: describe(err) };
  }
  return { category: 'UNKNOWN', message: describe(err) };
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNABORTED',
]);

function errorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 5 && current instanceof Error; i += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? `: ${cause.message}` : '';
  return `${err.message}${causeText}`.slice(0, 300);
}
