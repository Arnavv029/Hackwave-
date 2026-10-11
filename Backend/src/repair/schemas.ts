import { z } from 'zod';
import { providerKeySchema } from '../providers/contracts.js';

/**
 * Typed repair rules. A rule is data: it names the scope it applies to, the
 * finding shapes it can answer, one declarative transform, and an explicit
 * policy for every edge case. There is no code in a rule and nothing here is
 * ever evaluated as JavaScript.
 */

/** Dot path into an external payload (`page.total`); no array indexing. */
export const pathSchema = z.string().min(1).max(200).regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, 'dot-separated identifiers');
/** Field name in the stable internal contract. */
export const internalFieldSchema = z.string().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const valueTypeSchema = z.enum(['string', 'number', 'integer', 'boolean']);
export type ValueType = z.infer<typeof valueTypeSchema>;

/** 1. Map a renamed external field onto a stable internal field. */
export const renameFieldTransformSchema = z
  .object({
    type: z.literal('rename_field'),
    /** The external path that disappeared (kept to detect conflicts). */
    from: pathSchema,
    /** The external path that now carries the value. */
    renamedTo: pathSchema,
    /** Internal contract field receiving the value. */
    internalField: internalFieldSchema,
    expectedType: valueTypeSchema,
  })
  .strict();

/** 2. Explicit external-path -> internal-field mapping (one or more). */
export const fieldPathMappingTransformSchema = z
  .object({
    type: z.literal('field_path_mapping'),
    mappings: z
      .array(
        z
          .object({
            from: pathSchema,
            internalField: internalFieldSchema,
            expectedType: valueTypeSchema,
            /** Used only when `onMissing` is `default`. */
            default: z.union([z.string(), z.number(), z.boolean()]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

/** 3. Explicitly approved mapping of external enum values onto internal ones. */
export const enumMappingTransformSchema = z
  .object({
    type: z.literal('enum_mapping'),
    from: pathSchema,
    internalField: internalFieldSchema,
    /** External value -> internal value. Values not listed are rejected. */
    mapping: z.record(z.string().min(1).max(100), z.string().min(1).max(100)).refine((m) => Object.keys(m).length > 0, 'mapping must not be empty'),
    /** Internal values the contract accepts; every mapping target must be one of them. */
    allowedInternalValues: z.array(z.string().min(1).max(100)).min(1).max(100),
  })
  .strict()
  .superRefine((t, ctx) => {
    for (const [from, to] of Object.entries(t.mapping)) {
      if (!t.allowedInternalValues.includes(to)) {
        ctx.addIssue({ code: 'custom', path: ['mapping', from], message: `maps to "${to}", which is not an allowed internal value` });
      }
    }
  });

export const transformSchema = z.discriminatedUnion('type', [renameFieldTransformSchema, fieldPathMappingTransformSchema, enumMappingTransformSchema]);
export type Transform = z.infer<typeof transformSchema>;

/** 4. What to do in every edge case. Defaults reject rather than guess. */
export const policySchema = z
  .object({
    onMissing: z.enum(['reject', 'null', 'default']).default('reject'),
    onNull: z.enum(['reject', 'keep_null']).default('reject'),
    onTypeMismatch: z.enum(['reject']).default('reject'),
    /** When both the old and the renamed field are present with different values. */
    onConflict: z.enum(['reject', 'prefer_old', 'prefer_new']).default('reject'),
    /** External fields that no mapping consumes. */
    onExtraFields: z.enum(['drop', 'reject']).default('drop'),
    /** Numeric strings such as "1250" for an integer field. Off unless explicitly enabled. */
    allowNumericStrings: z.boolean().default(false),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;

export const matchSchema = z
  .object({
    /** Finding rule ids this repair can answer. */
    findingRules: z.array(z.string().min(1).max(64)).min(1).max(10),
    /** Changed external path the finding must name (exact after `[]` removal). */
    path: pathSchema.optional(),
    /** For rename findings: the new path the finding must report. */
    renamedTo: pathSchema.optional(),
    /** For enum findings: external values the finding must report (subset match). */
    values: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict();

export const repairRuleSpecSchema = z
  .object({
    key: z.string().min(3).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase slug'),
    title: z.string().min(1).max(200),
    description: z.string().max(2_000).default(''),
    scope: z
      .object({
        provider: providerKeySchema,
        /** `POST /charges` or `*` for every endpoint of the provider. */
        endpointKey: z.string().min(1).max(256),
        adapterKey: z.string().min(1).max(200),
      })
      .strict(),
    match: matchSchema,
    transform: transformSchema,
    policy: policySchema.prefault({}),
    risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    /** Operators can mark a rule as always needing a human; defaults to true. */
    requiresHumanReview: z.boolean().default(true),
    /** Example payloads that must normalise successfully (regression for the rule itself). */
    fixtures: z
      .array(z.object({ name: z.string().min(1).max(100), payload: z.record(z.string(), z.unknown()), expectOk: z.boolean().default(true) }).strict())
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    const t = r.transform;
    if (t.type === 'rename_field' && r.match.path && r.match.path !== t.from) {
      ctx.addIssue({ code: 'custom', path: ['match', 'path'], message: 'must equal transform.from for rename_field' });
    }
    if (t.type === 'enum_mapping' && r.match.path && r.match.path !== t.from) {
      ctx.addIssue({ code: 'custom', path: ['match', 'path'], message: 'must equal transform.from for enum_mapping' });
    }
  });
export type RepairRuleSpec = z.infer<typeof repairRuleSpecSchema>;

// ---------------------------------------------------------------------------
// API inputs
// ---------------------------------------------------------------------------

export const actorSchema = z.string().min(1).max(128);

export const registerRuleSchema = z.object({ spec: repairRuleSpecSchema, createdBy: actorSchema.default('system') }).strict();
export const approveRuleSchema = z.object({ approvedBy: actorSchema, note: z.string().max(500).optional() }).strict();

export const proposeSchema = z
  .object({
    findingId: z.string().uuid(),
    /** Persisted impact snapshot to consult; the latest one for the finding is used when omitted. */
    impactReportId: z.string().uuid().optional(),
    createdBy: actorSchema.default('system'),
  })
  .strict();

export const executeSchema = z
  .object({
    /** Explicit payloads; when omitted the finding's observation sample is used. */
    payloads: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
    executedBy: actorSchema.default('system'),
  })
  .strict();

export const validateSchema = z
  .object({
    /** How many recent observations of the endpoint to replay (in addition to rule fixtures). */
    recentObservations: z.number().int().min(0).max(100).default(10),
    executedBy: actorSchema.default('system'),
  })
  .strict();

export const reviewProposalSchema = z.object({ decision: z.enum(['approve', 'reject']), reviewer: actorSchema, note: z.string().max(1_000).optional() }).strict();
export const activateSchema = z.object({ actor: actorSchema, confirm: z.literal(true) }).strict();

export const normalizeSchema = z
  .object({
    endpointKey: z.string().min(1).max(256),
    payload: z.record(z.string(), z.unknown()),
    /** Try a candidate version instead of the ACTIVE one (never persists anything). */
    proposalId: z.string().uuid().optional(),
  })
  .strict();

export const listRulesQuerySchema = z
  .object({ provider: providerKeySchema.optional(), status: z.enum(['DRAFT', 'APPROVED', 'RETIRED']).optional(), key: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })
  .strict();
export const listProposalsQuerySchema = z
  .object({
    findingId: z.string().uuid().optional(),
    status: z.enum(['DRAFT', 'PENDING_REVIEW', 'VALIDATING', 'VALIDATED', 'BLOCKED', 'ACTIVE', 'ROLLED_BACK', 'REJECTED']).optional(),
    adapterKey: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
