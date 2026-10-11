import { z } from 'zod';
import { httpMethodSchema, providerKeySchema } from '../providers/contracts.js';

/**
 * Zod schemas for everything the observation engine persists or accepts.
 * These mirror the Prisma enums so a mismatch fails at the boundary, not in
 * the database.
 */

export const observationOutcomeSchema = z.enum([
  'SUCCESS',
  'HTTP_ERROR',
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK_ERROR',
  'UNAVAILABLE',
  'MALFORMED_RESPONSE',
]);
export type ObservationOutcomeValue = z.infer<typeof observationOutcomeSchema>;

export const errorCategorySchema = z.enum([
  'HTTP_ERROR',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'TIMEOUT',
  'CONNECTION_ERROR',
  'MALFORMED_JSON',
  'RESPONSE_TOO_LARGE',
  'UNKNOWN',
]);
export type ErrorCategoryValue = z.infer<typeof errorCategorySchema>;

export const parseOutcomeSchema = z.enum(['JSON', 'EMPTY', 'NON_JSON', 'MALFORMED_JSON', 'TRUNCATED', 'NOT_READ']);
export type ParseOutcomeValue = z.infer<typeof parseOutcomeSchema>;

export const jsonTypeSchema = z.enum(['string', 'number', 'boolean', 'null', 'object', 'array']);
export type JsonType = z.infer<typeof jsonTypeSchema>;

/** One flattened response field: `data[].shipment_id` -> `string`. */
export const fieldPathSchema = z.object({ path: z.string().min(1).max(256), type: jsonTypeSchema }).strict();
export type FieldPath = z.infer<typeof fieldPathSchema>;

export const MAX_FIELD_PATHS = 200;

/** Structural difference between two field-path sets. Evidence, not a verdict. */
export const shapeDeltaSchema = z
  .object({
    comparedTo: z.string().uuid(),
    added: z.array(z.string()).max(MAX_FIELD_PATHS),
    removed: z.array(z.string()).max(MAX_FIELD_PATHS),
    typeChanged: z.array(z.object({ path: z.string(), from: jsonTypeSchema, to: jsonTypeSchema }).strict()).max(MAX_FIELD_PATHS),
    unchanged: z.number().int().nonnegative(),
  })
  .strict();
export type ShapeDelta = z.infer<typeof shapeDeltaSchema>;

export const contractIssueSchema = z
  .object({ path: z.string(), code: z.string(), message: z.string().max(500) })
  .strict();

/** Result of checking the body against the declared endpoint contract. */
export const contractCheckSchema = z
  .object({
    checked: z.boolean(),
    valid: z.boolean().nullable(),
    /** Why the body was not checked (no JSON, non-success status...). */
    skippedReason: z.string().max(200).optional(),
    issues: z.array(contractIssueSchema).max(20),
    issueCount: z.number().int().nonnegative(),
  })
  .strict();
export type ContractCheck = z.infer<typeof contractCheckSchema>;

/** Sanitized request metadata. Never contains header values or secrets. */
export const requestMetaSchema = z
  .object({
    method: httpMethodSchema,
    /** Path only; query values are stripped. */
    path: z.string().max(2_048),
    queryKeys: z.array(z.string().max(128)).max(100),
    headerNames: z.array(z.string().max(128)).max(100),
    /** Names of request headers that carried credentials (values never stored). */
    redactedHeaders: z.array(z.string().max(128)).max(100),
    bodyBytes: z.number().int().nonnegative(),
    /** Redacted, bounded sample of the request body (JSON only). */
    bodySample: z.unknown().optional(),
    timeoutMs: z.number().int().positive(),
    maxResponseBytes: z.number().int().positive(),
  })
  .strict();
export type RequestMeta = z.infer<typeof requestMetaSchema>;

export const responseHeadersSchema = z
  .object({
    kept: z.record(z.string(), z.string()),
    redacted: z.array(z.string()),
    omitted: z.array(z.string()),
  })
  .strict();

/** The full record the engine writes. Validated before persistence. */
export const observationRecordSchema = z
  .object({
    providerKey: providerKeySchema,
    endpointKey: z.string().min(1).max(256),
    method: httpMethodSchema,
    observedAt: z.date(),
    latencyMs: z.number().int().nonnegative(),
    outcome: observationOutcomeSchema,
    errorCategory: errorCategorySchema.nullable(),
    /** Null when no HTTP response was received. */
    statusCode: z.number().int().min(100).max(599).nullable(),
    parseOutcome: parseOutcomeSchema,
    responseBytes: z.number().int().nonnegative(),
    correlationId: z.string().min(1).max(128).nullable(),
    scenario: z.string().max(64).nullable(),
    requestMeta: requestMetaSchema,
    responseHeaders: responseHeadersSchema,
    fieldPaths: z.array(fieldPathSchema).max(MAX_FIELD_PATHS).nullable(),
    shapeHash: z.string().length(64).nullable(),
    shapeDelta: shapeDeltaSchema.nullable(),
    responseSample: z.unknown(),
    contractCheck: contractCheckSchema,
    errorMessage: z.string().max(1_000).nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.outcome === 'SUCCESS' && r.errorCategory !== null) {
      ctx.addIssue({ code: 'custom', path: ['errorCategory'], message: 'SUCCESS observations cannot carry an error category' });
    }
    if (r.outcome !== 'SUCCESS' && r.errorCategory === null) {
      ctx.addIssue({ code: 'custom', path: ['errorCategory'], message: 'non-success observations must carry an error category' });
    }
    if ((r.errorCategory === 'TIMEOUT' || r.errorCategory === 'CONNECTION_ERROR') && r.statusCode !== null) {
      ctx.addIssue({ code: 'custom', path: ['statusCode'], message: 'status must be null when no HTTP response was received' });
    }
  });
export type ObservationRecord = z.infer<typeof observationRecordSchema>;

// ---------------------------------------------------------------------------
// API input schemas
// ---------------------------------------------------------------------------

export const correlationIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, 'alphanumeric, dot, underscore, colon or dash');

/** Body of POST /api/probes. */
export const probeRequestSchema = z
  .object({
    provider: providerKeySchema,
    /** Endpoint name from the provider contract, e.g. `createCharge`. */
    endpoint: z.string().min(1).max(64),
    pathParams: z.record(z.string(), z.string().min(1).max(128)).default({}),
    query: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    body: z.unknown().optional(),
    correlationId: correlationIdSchema.optional(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
    maxResponseBytes: z.number().int().min(1_024).max(10_485_760).optional(),
  })
  .strict();
export type ProbeRequest = z.infer<typeof probeRequestSchema>;

export const OBSERVATION_PAGE_MAX = 200;

/** Query string of GET /api/observations. */
export const listObservationsQuerySchema = z
  .object({
    provider: providerKeySchema.optional(),
    endpoint: z.string().min(1).max(256).optional(),
    method: httpMethodSchema.optional(),
    status: z.coerce.number().int().min(100).max(599).optional(),
    outcome: observationOutcomeSchema.optional(),
    errorCategory: errorCategorySchema.optional(),
    correlationId: correlationIdSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sort: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().min(1).max(OBSERVATION_PAGE_MAX).default(50),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict()
  .refine((q) => !(q.from && q.to) || q.from <= q.to, { path: ['from'], message: '`from` must not be after `to`' });
export type ListObservationsQuery = z.infer<typeof listObservationsQuerySchema>;

export const observationIdSchema = z.string().uuid();
