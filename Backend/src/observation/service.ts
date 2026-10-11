import type { Logger } from '../logger.js';
import { NotFoundError, ValidationError } from '../errors.js';
import {
  endpointKey as toEndpointKey,
  expandPath,
  getEndpointContract,
  providerContracts,
  type EndpointContract,
  type ProviderKey,
} from '../providers/contracts.js';
import { redactHeaders, redactText, sanitizeUrl } from '../security/redact.js';
import type { ProviderCallResult, ProviderClient } from './provider-client.js';
import {
  observationRecordSchema,
  type ContractCheck,
  type ErrorCategoryValue,
  type ObservationOutcomeValue,
  type ObservationRecord,
  type ParseOutcomeValue,
  type ProbeRequest,
} from './schemas.js';
import { boundedSample, diffFieldPaths, extractFieldPaths, hashFieldPaths } from './shape.js';
import type { ObservationStore, StoredObservation } from './store.js';

export interface ObservationEngineDeps {
  client: ProviderClient;
  store: ObservationStore;
  logger: Logger;
  /** Base URL under which `/<provider>` is reachable; evaluated per call. */
  providerBaseUrl: (provider: ProviderKey) => string;
  /** Resolve a provider's `secretRef` to a credential, or undefined. The value never leaves the client. */
  resolveSecret: (secretRef: string) => string | undefined;
  defaultTimeoutMs: number;
  defaultMaxResponseBytes: number;
}

/**
 * The observation engine: call a provider endpoint through the bounded
 * client, turn whatever happened into a validated, redacted record, compare
 * its shape with the previous one, and persist it. It classifies transport
 * and parsing failures; it does NOT decide whether a difference is breaking.
 */
export class ObservationEngine {
  constructor(private readonly deps: ObservationEngineDeps) {}

  async probe(input: ProbeRequest): Promise<StoredObservation> {
    const contract = getEndpointContract(input.provider, input.endpoint);
    if (!contract) {
      throw new NotFoundError(`Unknown endpoint "${input.endpoint}" for provider "${input.provider}"`, {
        available: Object.keys(providerContracts[input.provider].endpoints),
      });
    }
    this.validateProbeInput(contract, input);

    const baseUrl = this.deps.providerBaseUrl(input.provider).replace(/\/$/, '');
    let path: string;
    try {
      path = expandPath(contract.path, input.pathParams);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'invalid path parameters', { pathParams: contract.pathParams });
    }
    const url = new URL(`${baseUrl}/${input.provider}${path}`);
    for (const [k, v] of Object.entries(input.query)) url.searchParams.set(k, String(v));

    const timeoutMs = input.timeoutMs ?? this.deps.defaultTimeoutMs;
    const maxResponseBytes = input.maxResponseBytes ?? this.deps.defaultMaxResponseBytes;
    const headers: Record<string, string> = {};
    const secret = this.deps.resolveSecret(providerContracts[input.provider].secretRef);
    if (secret) headers['authorization'] = `Bearer ${secret}`;
    if (input.correlationId) headers['x-correlation-id'] = input.correlationId;

    const observedAt = new Date();
    const result = await this.deps.client.call({
      method: contract.method,
      url: url.toString(),
      headers,
      body: input.body,
      timeoutMs,
      maxResponseBytes,
    });

    const record = await this.buildRecord({ input, contract, url: url.toString(), headers, result, observedAt, timeoutMs, maxResponseBytes });
    const stored = await this.deps.store.save(record, { provider: input.provider, endpoint: contract, baseUrl: `${baseUrl}/${input.provider}` });

    // Log only identity and classification: never bodies, never header values.
    this.deps.logger.info(
      {
        observationId: stored.id,
        provider: record.providerKey,
        endpoint: record.endpointKey,
        status: record.statusCode,
        outcome: record.outcome,
        errorCategory: record.errorCategory,
        latencyMs: record.latencyMs,
        correlationId: record.correlationId,
        scenario: record.scenario,
        contractValid: record.contractCheck.valid,
        shapeChanged: record.shapeDelta ? record.shapeDelta.added.length + record.shapeDelta.removed.length + record.shapeDelta.typeChanged.length > 0 : null,
      },
      'observation recorded',
    );
    return stored;
  }

  private validateProbeInput(contract: EndpointContract, input: ProbeRequest): void {
    if (contract.requestBody) {
      const parsed = contract.requestBody.safeParse(input.body);
      if (!parsed.success) {
        throw new ValidationError('Request body does not satisfy the endpoint contract', parsed.error.issues.map(issueToWire));
      }
    }
    if (contract.query) {
      const parsed = contract.query.safeParse(input.query);
      if (!parsed.success) throw new ValidationError('Query does not satisfy the endpoint contract', parsed.error.issues.map(issueToWire));
    }
    for (const p of contract.pathParams) {
      if (!input.pathParams[p]) throw new ValidationError(`Missing path parameter "${p}"`, { pathParams: contract.pathParams });
    }
  }

  private async buildRecord(ctx: {
    input: ProbeRequest;
    contract: EndpointContract;
    url: string;
    headers: Record<string, string>;
    result: ProviderCallResult;
    observedAt: Date;
    timeoutMs: number;
    maxResponseBytes: number;
  }): Promise<ObservationRecord> {
    const { input, contract, result } = ctx;
    const endpointKey = toEndpointKey(contract);
    const parsed = parseBody(result);
    const classification = classify(result, parsed.outcome);
    const responseHeaders = redactHeaders(result.headers);
    const scenario = responseHeaders.kept['x-mock-scenario'] ?? null;

    let fieldPaths: ObservationRecord['fieldPaths'] = null;
    let shapeHash: string | null = null;
    let shapeDelta: ObservationRecord['shapeDelta'] = null;
    if (parsed.outcome === 'JSON') {
      fieldPaths = extractFieldPaths(parsed.value);
      shapeHash = hashFieldPaths(fieldPaths);
      const previous = await this.deps.store.latestWithShape(input.provider, endpointKey);
      if (previous?.fieldPaths) shapeDelta = diffFieldPaths(previous.fieldPaths, fieldPaths, previous.id);
    }

    const sanitizedUrl = sanitizeUrl(ctx.url);
    const requestHeaders = redactHeaders(ctx.headers, new Set());
    const record: ObservationRecord = {
      providerKey: input.provider,
      endpointKey,
      method: contract.method,
      observedAt: ctx.observedAt,
      latencyMs: result.latencyMs,
      outcome: classification.outcome,
      errorCategory: classification.errorCategory,
      statusCode: result.status,
      parseOutcome: parsed.outcome,
      responseBytes: result.bodyBytes,
      correlationId: input.correlationId ?? null,
      scenario,
      requestMeta: {
        method: contract.method,
        path: sanitizedUrl.path,
        queryKeys: sanitizedUrl.queryKeys,
        headerNames: Object.keys(ctx.headers).map((h) => h.toLowerCase()).sort(),
        redactedHeaders: requestHeaders.redacted,
        bodyBytes: result.requestBytes,
        ...(input.body !== undefined ? { bodySample: boundedSample(input.body) } : {}),
        timeoutMs: ctx.timeoutMs,
        maxResponseBytes: ctx.maxResponseBytes,
      },
      responseHeaders,
      fieldPaths,
      shapeHash,
      shapeDelta,
      responseSample: parsed.outcome === 'JSON' ? boundedSample(parsed.value) : parsed.preview !== undefined ? { raw: parsed.preview } : null,
      contractCheck: checkContract(contract, result.status, parsed),
      errorMessage: buildErrorMessage(result, parsed, classification),
    };

    const validated = observationRecordSchema.safeParse(record);
    if (!validated.success) {
      // A bug in the engine, not in the provider: fail loudly rather than persist junk.
      throw new Error(`observation record failed validation: ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    return validated.data;
  }
}

interface ParsedBody {
  outcome: ParseOutcomeValue;
  value?: unknown;
  /** Redacted text preview for non-JSON / malformed bodies. */
  preview?: string;
  error?: string;
}

function parseBody(result: ProviderCallResult): ParsedBody {
  if (result.failure && (result.failure.category === 'TIMEOUT' || result.failure.category === 'CONNECTION_ERROR')) {
    return { outcome: 'NOT_READ' };
  }
  if (result.truncated) return { outcome: 'TRUNCATED' };
  if (result.status === null) return { outcome: 'NOT_READ' };
  if (result.bodyText.length === 0) return { outcome: 'EMPTY' };
  const contentType = result.headers.find(([k]) => k === 'content-type')?.[1] ?? '';
  const looksJson = /json/i.test(contentType) || /^[\s]*[[{]/.test(result.bodyText);
  if (!looksJson) return { outcome: 'NON_JSON', preview: redactText(result.bodyText.slice(0, 512)) };
  try {
    return { outcome: 'JSON', value: JSON.parse(result.bodyText) as unknown };
  } catch (err) {
    return {
      outcome: 'MALFORMED_JSON',
      preview: redactText(result.bodyText.slice(0, 512)),
      error: err instanceof Error ? err.message.slice(0, 200) : 'invalid JSON',
    };
  }
}

function classify(
  result: ProviderCallResult,
  parse: ParseOutcomeValue,
): { outcome: ObservationOutcomeValue; errorCategory: ErrorCategoryValue | null } {
  if (result.failure) {
    switch (result.failure.category) {
      case 'TIMEOUT':
        return { outcome: 'TIMEOUT', errorCategory: 'TIMEOUT' };
      case 'CONNECTION_ERROR':
        return { outcome: 'NETWORK_ERROR', errorCategory: 'CONNECTION_ERROR' };
      case 'RESPONSE_TOO_LARGE':
        return { outcome: 'MALFORMED_RESPONSE', errorCategory: 'RESPONSE_TOO_LARGE' };
      case 'UNKNOWN':
        return { outcome: 'NETWORK_ERROR', errorCategory: 'UNKNOWN' };
    }
  }
  const status = result.status;
  if (status === null) return { outcome: 'NETWORK_ERROR', errorCategory: 'UNKNOWN' };
  if (status === 429) return { outcome: 'RATE_LIMITED', errorCategory: 'RATE_LIMITED' };
  if (status === 502 || status === 503 || status === 504) return { outcome: 'UNAVAILABLE', errorCategory: 'UNAVAILABLE' };
  if (status >= 400) return { outcome: 'HTTP_ERROR', errorCategory: 'HTTP_ERROR' };
  if (parse === 'MALFORMED_JSON') return { outcome: 'MALFORMED_RESPONSE', errorCategory: 'MALFORMED_JSON' };
  return { outcome: 'SUCCESS', errorCategory: null };
}

function checkContract(contract: EndpointContract, status: number | null, parsed: ParsedBody): ContractCheck {
  const none = (reason: string): ContractCheck => ({ checked: false, valid: null, skippedReason: reason, issues: [], issueCount: 0 });
  if (status === null) return none('no HTTP response');
  if (!contract.successStatuses.includes(status)) return none(`status ${status} is not a contract success status`);
  if (parsed.outcome !== 'JSON') return none(`body was ${parsed.outcome}`);
  const result = contract.response.safeParse(parsed.value);
  if (result.success) return { checked: true, valid: true, issues: [], issueCount: 0 };
  const issues = result.error.issues.map(issueToWire);
  return { checked: true, valid: false, issues: issues.slice(0, 20), issueCount: issues.length };
}

function issueToWire(issue: { path: PropertyKey[]; code: string; message: string }): { path: string; code: string; message: string } {
  return { path: issue.path.map(String).join('.') || '(root)', code: issue.code, message: issue.message.slice(0, 500) };
}

function buildErrorMessage(
  result: ProviderCallResult,
  parsed: ParsedBody,
  classification: { errorCategory: ErrorCategoryValue | null },
): string | null {
  if (result.failure) return redactText(result.failure.message).slice(0, 1_000);
  if (classification.errorCategory === 'MALFORMED_JSON') return `malformed JSON: ${parsed.error ?? 'parse error'}`.slice(0, 1_000);
  if (classification.errorCategory !== null && result.status !== null) {
    const retryAfter = result.headers.find(([k]) => k === 'retry-after')?.[1];
    return `HTTP ${result.status}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`;
  }
  return null;
}
