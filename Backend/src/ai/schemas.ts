import { z } from 'zod';

/**
 * Phase 6 schemas.
 *
 * `aiProposalOutputSchema` is what the model must return (fed to the
 * provider's structured-output API). It is deliberately flat, enum-driven
 * and free of defaults/refinements so it converts cleanly to JSON Schema.
 * Everything the backend decides (status, risk, approval) is NOT in it.
 */

export const SUPPORTED_TRANSFORM_TYPES = ['rename_field', 'field_path_mapping', 'enum_mapping', 'none'] as const;
export const AI_VALUE_TYPES = ['string', 'number', 'integer', 'boolean'] as const;

const shortText = z.string().max(500);
const path = z.string().max(200);

export const aiProposalOutputSchema = z.object({
  /** One or two sentences describing what changed between the samples. */
  summary: shortText,
  change_type: z.enum(['field_renamed', 'field_moved', 'enum_value_added', 'type_changed', 'field_removed', 'unknown']),
  transformation: z.object({
    type: z.enum(SUPPORTED_TRANSFORM_TYPES),
    rename_field: z
      .object({ from: path, renamed_to: path, internal_field: path, expected_type: z.enum(AI_VALUE_TYPES) })
      .nullable(),
    field_path_mapping: z
      .object({ mappings: z.array(z.object({ from: path, internal_field: path, expected_type: z.enum(AI_VALUE_TYPES) })).max(20) })
      .nullable(),
    enum_mapping: z
      .object({ from: path, internal_field: path, mapping: z.array(z.object({ external: z.string().max(100), internal: z.string().max(100) })).max(50) })
      .nullable(),
  }),
  fields_affected: z.array(path).max(50),
  assumptions: z.array(shortText).max(20),
  ambiguities: z.array(shortText).max(20),
  evidence: z.array(z.object({ claim: shortText, sample: z.enum(['old', 'new', 'both']), path })).max(30),
  suggested_tests: z.array(z.object({ name: z.string().max(120), input_description: shortText, expected_outcome: shortText })).max(20),
  unsafe_reasons: z.array(shortText).max(20),
  /** The model's own confidence; informational only, never a gate on its own. */
  confidence: z.enum(['low', 'medium', 'high']),
});
export type AiProposalOutput = z.infer<typeof aiProposalOutputSchema>;

/** The structured, size-limited input we give the model. */
export const changeReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.string(),
    endpointKey: z.string(),
    method: z.string(),
    adapterKey: z.string(),
    internalContract: z.object({ name: z.string(), fields: z.record(z.string(), z.object({ type: z.string(), description: z.string(), enum: z.array(z.string()).optional() })) }),
    baseMapping: z.array(z.object({ from: z.string(), internalField: z.string(), expectedType: z.string() })),
    baseline: z.object({ id: z.string(), version: z.number().int(), sampleCount: z.number().int(), windowTo: z.string() }).nullable(),
    finding: z.object({ id: z.string(), rule: z.string(), severity: z.string(), summary: z.string(), occurrenceCount: z.number().int() }),
    structuralChanges: z.object({ added: z.array(z.string()), removed: z.array(z.string()), typeChanged: z.array(z.object({ path: z.string(), from: z.string(), to: z.string() })), changedPath: z.string().nullable(), newValues: z.array(z.string()) }),
    samples: z.object({
      old: z.object({ observationId: z.string(), observedAt: z.string(), body: z.unknown() }).nullable(),
      new: z.object({ observationId: z.string(), observedAt: z.string(), body: z.unknown() }),
      truncated: z.boolean(),
    }),
    impact: z
      .object({ reportId: z.string(), dependents: z.number().int(), direct: z.number().int(), maxLikelihood: z.string(), tests: z.array(z.string()), truncated: z.boolean(), topDependents: z.array(z.object({ key: z.string(), kind: z.string(), likelihood: z.string() })) })
      .nullable(),
    supportedTransformations: z.array(z.string()),
    /** Backend-detected signs of prompt injection or oddities inside samples. Informational. */
    warnings: z.array(z.string()),
  })
  .strict();
export type ChangeReport = z.infer<typeof changeReportSchema>;

export const AI_PROPOSAL_STATUSES = ['PENDING_REVIEW', 'NEEDS_INFORMATION', 'REJECTED_BY_POLICY', 'FAILED_VALIDATION', 'PROVIDER_ERROR', 'PROMOTED', 'DISMISSED'] as const;

// --- API inputs -------------------------------------------------------------

export const actorSchema = z.string().min(1).max(128);
export const aiProposeSchema = z
  .object({
    findingId: z.string().uuid(),
    impactReportId: z.string().uuid().optional(),
    createdBy: actorSchema.default('system'),
  })
  .strict();
export const promoteSchema = z.object({ actor: actorSchema, note: z.string().max(500).optional() }).strict();
export const dismissSchema = z.object({ actor: actorSchema, note: z.string().max(500).optional() }).strict();
export const listAiProposalsQuerySchema = z
  .object({
    findingId: z.string().uuid().optional(),
    status: z.enum(AI_PROPOSAL_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
