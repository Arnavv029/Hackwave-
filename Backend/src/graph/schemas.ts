import { z } from 'zod';

/**
 * Graph vocabulary and validation. See prisma/schema.prisma for the direction
 * convention: every edge points upstream -> downstream (impact flow).
 */

export const NODE_KINDS = ['PROVIDER', 'OPERATION', 'CLIENT', 'ADAPTER', 'SERVICE', 'WORKFLOW', 'TEST'] as const;
export type NodeKindValue = (typeof NODE_KINDS)[number];
export const nodeKindSchema = z.enum(NODE_KINDS);

export const EDGE_RELATIONS = ['EXPOSES', 'CALLS', 'NORMALIZES', 'USES', 'FEEDS_INTO', 'CONSUMES', 'COVERED_BY'] as const;
export type EdgeRelationValue = (typeof EDGE_RELATIONS)[number];
export const edgeRelationSchema = z.enum(EDGE_RELATIONS);

export const EDGE_PROVENANCES = ['OBSERVED', 'MANUAL', 'INFERRED'] as const;
export type EdgeProvenanceValue = (typeof EDGE_PROVENANCES)[number];
export const edgeProvenanceSchema = z.enum(EDGE_PROVENANCES);

export const criticalitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Allowed (upstream kind, downstream kind) pairs per relation. An edge whose
 * kinds are not listed is rejected; a reversed pair gets a hint.
 */
export const ALLOWED_EDGES: Record<EdgeRelationValue, ReadonlyArray<readonly [NodeKindValue, NodeKindValue]>> = {
  EXPOSES: [['PROVIDER', 'OPERATION']],
  CALLS: [
    ['OPERATION', 'ADAPTER'],
    ['OPERATION', 'SERVICE'],
    ['OPERATION', 'CLIENT'],
  ],
  NORMALIZES: [['OPERATION', 'ADAPTER']],
  USES: [
    ['ADAPTER', 'SERVICE'],
    ['ADAPTER', 'WORKFLOW'],
    ['CLIENT', 'SERVICE'],
    ['SERVICE', 'SERVICE'],
  ],
  FEEDS_INTO: [
    ['SERVICE', 'WORKFLOW'],
    ['SERVICE', 'SERVICE'],
    ['WORKFLOW', 'WORKFLOW'],
  ],
  CONSUMES: [
    ['CLIENT', 'WORKFLOW'],
    ['ADAPTER', 'WORKFLOW'],
  ],
  COVERED_BY: [
    ['ADAPTER', 'TEST'],
    ['SERVICE', 'TEST'],
    ['WORKFLOW', 'TEST'],
  ],
};

export function isAllowedEdge(relation: EdgeRelationValue, from: NodeKindValue, to: NodeKindValue): boolean {
  return ALLOWED_EDGES[relation].some(([a, b]) => a === from && b === to);
}

/** Node key: stable, human readable, e.g. `adapter:PaymentsAdapter`. */
export const nodeKeySchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:/{}[\]*-]+$/, 'letters, digits and : . / _ - only');

export const createNodeSchema = z
  .object({
    kind: nodeKindSchema,
    key: nodeKeySchema,
    name: z.string().min(1).max(200),
    parentKey: nodeKeySchema.optional(),
    enabled: z.boolean().default(true),
    criticality: criticalitySchema.default('MEDIUM'),
    baseUrl: z.string().url().max(500).optional(),
    secretRef: z.string().max(100).optional(),
    method: z.string().max(10).optional(),
    path: z.string().max(300).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = createNodeSchema.omit({ kind: true, key: true }).partial().strict();
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

export const fieldPathSchema = z.string().min(1).max(256);

export const createEdgeSchema = z
  .object({
    /** Upstream node (key or id). */
    from: z.string().min(1).max(200),
    /** Downstream node (key or id). */
    to: z.string().min(1).max(200),
    relation: edgeRelationSchema,
    provenance: edgeProvenanceSchema.default('MANUAL'),
    confidence: z.number().min(0).max(1).optional(),
    /** Upstream payload fields the downstream consumes. Empty = unknown. */
    consumedFields: z.array(fieldPathSchema).max(200).default([]),
    note: z.string().max(500).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type CreateEdgeInput = z.infer<typeof createEdgeSchema>;

export const updateEdgeSchema = z
  .object({
    provenance: edgeProvenanceSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    consumedFields: z.array(fieldPathSchema).max(200).optional(),
    note: z.string().max(500).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type UpdateEdgeInput = z.infer<typeof updateEdgeSchema>;

export const listNodesQuerySchema = z
  .object({
    kind: nodeKindSchema.optional(),
    enabled: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    q: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const listEdgesQuerySchema = z
  .object({
    from: z.string().min(1).max(200).optional(),
    to: z.string().min(1).max(200).optional(),
    relation: edgeRelationSchema.optional(),
    provenance: edgeProvenanceSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1_000).default(200),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

/** Traversal limits. Deliberately bounded so a hostile graph cannot pin the server. */
export const traversalLimitsSchema = z
  .object({
    maxDepth: z.coerce.number().int().min(1).max(20).default(6),
    maxNodes: z.coerce.number().int().min(1).max(5_000).default(500),
    maxPaths: z.coerce.number().int().min(1).max(2_000).default(200),
    /** Extra paths kept per dependent beyond the first (duplicate-path tracking). */
    maxPathsPerNode: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict();
export type TraversalLimits = z.infer<typeof traversalLimitsSchema>;

export const impactByNodeQuerySchema = traversalLimitsSchema.extend({
  node: z.string().min(1).max(200),
  /** Optional changed field path, to rank by field consumption without a finding. */
  path: fieldPathSchema.optional(),
}).strict();

export const persistImpactBodySchema = z.object({ createdBy: z.string().min(1).max(128).default('system') }).merge(traversalLimitsSchema.partial()).strict();
