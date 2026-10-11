/**
 * Redaction applied to anything that leaves the request/response boundary:
 * stored observations, audit details and log lines. Runs BEFORE persistence
 * and BEFORE logging; the Pino redact list is only a second line of defence.
 */

export const REDACTED = '[REDACTED]';

/** Header names whose values are credentials or session material. */
export const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
  'api-key',
  'apikey',
]);

/**
 * Response headers that are safe and useful to persist (rate limiting,
 * pagination, correlation, caching). Anything else is recorded by name only.
 */
export const PERSISTED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'date',
  'etag',
  'cache-control',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-request-id',
  'x-correlation-id',
  'x-next-cursor',
  'x-total-count',
  'link',
  'x-mock-scenario',
  'x-mock-provider',
]);

/**
 * Object keys (case-insensitive, separators ignored) whose values are
 * replaced wherever they appear in a JSON document.
 */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /^(authorization|proxyauthorization)$/,
  /^(cookie|setcookie)$/,
  /password|passwd|pwd$/,
  /secret/,
  /token$/,
  /^token/,
  /apikey$/,
  /^(accesskey|secretkey|privatekey|clientsecret|sessionid|sessionkey)$/,
  /(credential|credentials)$/,
  /^(ssn|socialsecuritynumber|taxid)$/,
  /(cardnumber|cardno|pan|cvv|cvc|cvv2|securitycode)$/,
  /^(iban|accountnumber|routingnumber)$/,
];

/** String values that look like credentials regardless of their key. */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /^\s*(bearer|basic|digest|token)\s+\S+/i,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/, // JWT
  /^(sk|pk|rk|whsec|ghp|gho|xox[abp])[_-][A-Za-z0-9_-]{8,}$/i, // common API key prefixes
  /^AKIA[0-9A-Z]{16}$/, // AWS access key id
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(k));
}

export function isSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value));
}

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) || isSensitiveKey(name);
}

/**
 * Deep-copy `value`, replacing sensitive leaf values. Depth is bounded so
 * hostile payloads cannot cause unbounded recursion; anything deeper than
 * `maxDepth` is replaced with a marker rather than stored raw.
 */
export function redactValue(value: unknown, maxDepth = 12): unknown {
  return walk(value, 0, maxDepth, false);
}

function walk(value: unknown, depth: number, maxDepth: number, underSensitiveKey: boolean): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return underSensitiveKey || isSensitiveValue(value) ? REDACTED : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return underSensitiveKey ? REDACTED : value;
  }
  if (typeof value === 'bigint') return underSensitiveKey ? REDACTED : value.toString();
  if (typeof value !== 'object') return REDACTED; // functions, symbols
  if (depth >= maxDepth) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, depth + 1, maxDepth, underSensitiveKey));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const sensitive = underSensitiveKey || isSensitiveKey(k);
    out[k] = sensitive && (v === null || typeof v !== 'object') ? REDACTED : walk(v, depth + 1, maxDepth, sensitive);
  }
  return out;
}

export interface RedactedHeaders {
  /** Header name -> value for headers safe to keep. */
  kept: Record<string, string>;
  /** Names of headers whose values were sensitive (values dropped). */
  redacted: string[];
  /** Names of headers that were neither sensitive nor on the allow list. */
  omitted: string[];
}

/**
 * Split headers into what may be persisted and what may not. Sensitive
 * headers are listed by name only; unknown headers are omitted by name so
 * an analyst can still see the provider sent them.
 */
export function redactHeaders(
  headers: Iterable<[string, string]> | Record<string, string | string[] | undefined>,
  allowList: ReadonlySet<string> = PERSISTED_RESPONSE_HEADERS,
): RedactedHeaders {
  const entries: Array<[string, string]> = [];
  if (Symbol.iterator in Object(headers)) {
    for (const [k, v] of headers as Iterable<[string, string]>) entries.push([k, v]);
  } else {
    for (const [k, v] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
      if (v === undefined) continue;
      entries.push([k, Array.isArray(v) ? v.join(', ') : v]);
    }
  }
  const result: RedactedHeaders = { kept: {}, redacted: [], omitted: [] };
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (isSensitiveHeader(name)) {
      result.redacted.push(name);
    } else if (allowList.has(name) && !isSensitiveValue(value)) {
      result.kept[name] = value.length > 512 ? `${value.slice(0, 512)}…` : value;
    } else {
      result.omitted.push(name);
    }
  }
  result.redacted.sort();
  result.omitted.sort();
  return result;
}

/**
 * Scrub free text (error messages, body previews) of obvious credential
 * material. Used for text we cannot parse structurally.
 */
export function redactText(text: string): string {
  return text
    .replace(/\b(bearer|basic|digest)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/\b(sk|pk|rk|whsec|ghp|gho|xox[abp])[_-][A-Za-z0-9_-]{8,}/gi, REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)
    .replace(/((?:password|passwd|secret|token|api[_-]?key|cookie)\s*[=:]\s*)("?)[^\s"&,;]+\2/gi, `$1${REDACTED}`)
    .replace(/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s]+@/gi, `$1://${REDACTED}@`);
}

/** Strip query-string values from a URL, keeping the parameter names. */
export function sanitizeUrl(url: string): { path: string; queryKeys: string[] } {
  try {
    const u = new URL(url, 'http://placeholder.invalid');
    return { path: u.pathname, queryKeys: [...new Set(u.searchParams.keys())].sort() };
  } catch {
    return { path: '[unparseable]', queryKeys: [] };
  }
}
