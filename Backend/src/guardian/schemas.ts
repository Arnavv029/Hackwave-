import { z } from 'zod';
import { adapterSpecSchema } from './adapter.js';

/** Inputs of the Phase 9 monitor API. Everything the UI can send is validated here. */

export const monitorMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const environmentSchema = z.string().min(1).max(40);
export const authTypeSchema = z.enum(['NONE', 'BEARER', 'API_KEY', 'BASIC']);
export const actorSchema = z.string().min(1).max(128);
const headersSchema = z.record(z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/, 'header name'), z.string().max(2_000)).default({});

export const createMonitorSchema = z
  .object({
    name: z.string().min(1).max(120),
    url: z.string().min(1).max(2_000),
    method: monitorMethodSchema.default('GET'),
    environment: environmentSchema.default('Production'),
    description: z.string().max(1_000).default(''),
    intervalSec: z.number().int().min(10).max(86_400).default(300),
    timeoutMs: z.number().int().min(500).max(60_000).default(5_000),
    authType: authTypeSchema.default('NONE'),
    /** Plain secret; encrypted before it is stored, never returned. */
    authSecret: z.string().max(4_000).optional(),
    /** Header name for API_KEY auth. */
    authHeader: z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/).optional(),
    headers: headersSchema,
    body: z.unknown().optional(),
    expectedStatus: z.number().int().min(100).max(599).optional(),
    autoBaseline: z.boolean().default(true),
    createdBy: actorSchema.default('system'),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.authType !== 'NONE' && !m.authSecret) ctx.addIssue({ code: 'custom', path: ['authSecret'], message: 'a secret is required for this auth type' });
  });
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

export const updateMonitorSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    url: z.string().min(1).max(2_000).optional(),
    method: monitorMethodSchema.optional(),
    environment: environmentSchema.optional(),
    description: z.string().max(1_000).optional(),
    intervalSec: z.number().int().min(10).max(86_400).optional(),
    timeoutMs: z.number().int().min(500).max(60_000).optional(),
    authType: authTypeSchema.optional(),
    authSecret: z.string().max(4_000).optional(),
    authHeader: z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/).nullable().optional(),
    headers: headersSchema.optional(),
    body: z.unknown().optional(),
    expectedStatus: z.number().int().min(100).max(599).nullable().optional(),
    autoBaseline: z.boolean().optional(),
    actor: actorSchema.default('system'),
  })
  .strict();
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

export const testConnectionSchema = z
  .object({
    url: z.string().min(1).max(2_000),
    method: monitorMethodSchema.default('GET'),
    authType: authTypeSchema.default('NONE'),
    authSecret: z.string().max(4_000).optional(),
    authHeader: z.string().min(1).max(100).optional(),
    headers: headersSchema,
    body: z.unknown().optional(),
    timeoutMs: z.number().int().min(500).max(60_000).default(5_000),
    /** Reuse the stored secret of an existing monitor instead of sending it again. */
    monitorId: z.string().uuid().optional(),
  })
  .strict();
export type TestConnectionInput = z.infer<typeof testConnectionSchema>;

export const listMonitorsQuerySchema = z.object({ environment: environmentSchema.optional(), status: z.enum(['ACTIVE', 'PAUSED']).optional(), q: z.string().max(100).optional() }).strict();

export const createMappingSchema = z
  .object({
    feature: z.string().min(1).max(120),
    jsonPath: z.string().min(1).max(300),
    route: z.string().max(200).optional(),
    impactLevel: z.enum(['Critical', 'High', 'Medium', 'Low']).default('High'),
    description: z.string().max(500).optional(),
    symptom: z.string().max(500).optional(),
    createdBy: actorSchema.default('system'),
  })
  .strict();
export type CreateMappingInput = z.infer<typeof createMappingSchema>;

export const createBaselineSchema = z.object({ checkId: z.string().uuid().optional(), actor: actorSchema.default('system'), note: z.string().max(500).optional(), approve: z.boolean().default(true) }).strict();
export const reviewBaselineSchema = z.object({ actor: actorSchema, note: z.string().max(500).optional() }).strict();

export const incidentStatusSchema = z.enum(['OPEN', 'INVESTIGATING', 'AWAITING_FIX', 'RESOLVED']);
export const updateIncidentSchema = z.object({ status: incidentStatusSchema.optional(), assignee: z.string().max(128).nullable().optional(), note: z.string().max(1_000).optional(), actor: actorSchema.default('system') }).strict();
export const listIncidentsQuerySchema = z.object({ monitorId: z.string().uuid().optional(), status: incidentStatusSchema.optional(), severity: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();

export const proposalActionSchema = z.object({ actor: actorSchema, note: z.string().max(1_000).optional() }).strict();
export const createProposalSchema = z.object({ actor: actorSchema.default('system'), transform: adapterSpecSchema.optional(), proposedSolution: z.string().max(2_000).optional() }).strict();
export const listProposalsQuerySchema = z.object({ monitorId: z.string().uuid().optional(), incidentId: z.string().uuid().optional(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PROMOTED', 'ROLLED_BACK']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();

export const monitoringSettingsSchema = z
  .object({
    defaultInterval: z.string().regex(/^\d+(s|m|h)$/).default('5m'),
    defaultTimeout: z.number().int().min(500).max(60_000).default(5_000),
    defaultEnvironment: environmentSchema.default('Production'),
    alertSlack: z.boolean().default(false),
    alertEmail: z.boolean().default(false),
    alertPagerDuty: z.boolean().default(false),
    /** Block private / loopback / metadata destinations. */
    ssrfProtection: z.boolean().default(true),
    /** Default for new monitors: approve the first successful response as the baseline. */
    autoBaseline: z.boolean().default(true),
    /** Rename detection threshold (0..1). */
    renameThreshold: z.number().min(0.3).max(0.95).default(0.55),
    /** Flat paths whose values vary between calls; globs allowed. */
    volatileFields: z.array(z.string().min(1).max(100)).max(100).default(['id', '*_id', '*Id', '*_at', '*At', 'timestamp', 'created', 'updated', 'date', 'etag', 'request_id', 'nonce', 'token']),
    /** Open a Low incident for purely additive changes. */
    incidentOnAdditive: z.boolean().default(false),
  })
  .strict();
export type MonitoringSettings = z.infer<typeof monitoringSettingsSchema>;

export const profileSchema = z.object({ name: z.string().min(1).max(120).default('Operator'), email: z.string().max(200).default(''), role: z.string().max(120).default('Operator'), organization: z.string().max(120).default('') }).strict();
export type Profile = z.infer<typeof profileSchema>;

export const updateSettingsSchema = z.object({ monitoring: monitoringSettingsSchema.partial().optional(), profile: profileSchema.partial().optional(), actor: actorSchema.default('system') }).strict();

export const listAuditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(1_000).default(200), entityType: z.string().max(40).optional(), q: z.string().max(100).optional() }).strict();
export const listChecksQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }).strict();

/** Parse "5m" / "30s" / "1h" into seconds. */
export function intervalToSeconds(s: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(s.trim());
  if (!m) return 300;
  const n = Number(m[1]);
  return m[2] === 's' ? n : m[2] === 'm' ? n * 60 : n * 3600;
}
export function secondsToInterval(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}
