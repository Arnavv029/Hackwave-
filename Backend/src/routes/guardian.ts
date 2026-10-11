import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../errors.js';
import type { GuardianService } from '../guardian/service.js';
import type { GuardianEvents } from '../guardian/events.js';
import { actorSchema, createBaselineSchema, createMappingSchema, createMonitorSchema, createProposalSchema, listAuditQuerySchema, listChecksQuerySchema, listIncidentsQuerySchema, listMonitorsQuerySchema, listProposalsQuerySchema, proposalActionSchema, reviewBaselineSchema, testConnectionSchema, updateIncidentSchema, updateMonitorSchema, updateSettingsSchema } from '../guardian/schemas.js';

export interface GuardianRouterDeps {
  service: GuardianService;
  events: GuardianEvents;
  requireOperator: RequestHandler;
  /** Whether an operator token is configured at all (for /auth/whoami). */
  operatorAuthEnabled: boolean;
  operatorToken?: string | undefined;
}

const idSchema = z.string().uuid();
const parseId = (raw: unknown, what: string): string => {
  const p = idSchema.safeParse(raw);
  if (!p.success) throw new NotFoundError(`${what} not found`);
  return p.data;
};
const actorBody = z.object({ actor: actorSchema.default('system') }).strict();

/**
 * Phase 9 API (API Guardian workflow):
 *
 *   GET    /api/auth/whoami
 *   GET    /api/events                                SSE stream
 *   GET    /api/stats/overview
 *   GET    /api/settings            PUT /api/settings (operator)
 *   GET    /api/monitors            POST /api/monitors (operator)   POST /api/monitors/test (operator)
 *   GET    /api/monitors/:id        PATCH / DELETE (operator)
 *   POST   /api/monitors/:id/check | pause | resume | adapter/rollback (operator)
 *   GET    /api/monitors/:id/checks
 *   GET    /api/monitors/:id/baselines   POST (operator)   POST /:bid/approve | reject (operator)
 *   GET    /api/monitors/:id/mappings    POST (operator)   DELETE /:mid (operator)
 *   GET    /api/mappings
 *   GET    /api/incidents           GET /:id   PATCH /:id (operator)   POST /:id/proposals (operator)
 *   GET    /api/proposals           GET /:id   POST /:id/validate | approve | reject | promote (operator)
 *   GET    /api/audit
 */
export function createGuardianRouter(deps: GuardianRouterDeps): Router {
  const r = Router();
  const s = deps.service;
  const op = deps.requireOperator;

  r.get('/auth/whoami', (req, res) => {
    const header = req.headers.authorization;
    const presented = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const operator = !deps.operatorAuthEnabled || (presented.length > 0 && presented === deps.operatorToken);
    res.json({ data: { role: operator ? 'operator' : 'reader', authRequired: deps.operatorAuthEnabled, tokenPresented: presented.length > 0 } });
  });
  r.get('/events', deps.events.sseHandler());
  r.get('/stats/overview', async (_req, res) => {
    res.json({ data: await s.overview() });
  });
  r.get('/settings', async (_req, res) => {
    res.json({ data: await s.settings() });
  });
  r.put('/settings', op, async (req, res) => {
    res.json({ data: await s.updateSettings(updateSettingsSchema.parse(req.body)) });
  });

  // monitors
  r.get('/monitors', async (req, res) => {
    res.json({ data: await s.listMonitors(listMonitorsQuerySchema.parse(req.query)) });
  });
  r.post('/monitors', op, async (req, res) => {
    res.status(201).json({ data: await s.createMonitor(createMonitorSchema.parse(req.body)) });
  });
  r.post('/monitors/test', op, async (req, res) => {
    const body = testConnectionSchema.parse(req.body);
    const actor = typeof req.query['actor'] === 'string' ? req.query['actor'] : 'operator';
    res.json({ data: await s.testConnection(body, actor) });
  });
  r.get('/monitors/:id', async (req, res) => {
    res.json({ data: await s.getMonitor(parseId(req.params['id'], 'Monitor')) });
  });
  r.patch('/monitors/:id', op, async (req, res) => {
    res.json({ data: await s.updateMonitor(parseId(req.params['id'], 'Monitor'), updateMonitorSchema.parse(req.body)) });
  });
  r.delete('/monitors/:id', op, async (req, res) => {
    const { actor } = actorBody.parse(req.body ?? {});
    await s.deleteMonitor(parseId(req.params['id'], 'Monitor'), actor);
    res.status(204).end();
  });
  r.post('/monitors/:id/check', op, async (req, res) => {
    const { actor } = actorBody.parse(req.body ?? {});
    res.json({ data: await s.runCheck(parseId(req.params['id'], 'Monitor'), actor) });
  });
  r.post('/monitors/:id/pause', op, async (req, res) => {
    const { actor } = actorBody.parse(req.body ?? {});
    res.json({ data: await s.setPaused(parseId(req.params['id'], 'Monitor'), true, actor) });
  });
  r.post('/monitors/:id/resume', op, async (req, res) => {
    const { actor } = actorBody.parse(req.body ?? {});
    res.json({ data: await s.setPaused(parseId(req.params['id'], 'Monitor'), false, actor) });
  });
  r.post('/monitors/:id/adapter/rollback', op, async (req, res) => {
    const b = z.object({ actor: actorSchema, reason: z.string().min(1).max(500) }).strict().parse(req.body);
    res.json({ data: await s.rollbackAdapter(parseId(req.params['id'], 'Monitor'), b.actor, b.reason) });
  });
  r.get('/monitors/:id/checks', async (req, res) => {
    const q = listChecksQuerySchema.parse(req.query);
    res.json({ data: await s.listChecks(parseId(req.params['id'], 'Monitor'), q.limit) });
  });
  r.get('/monitors/:id/baselines', async (req, res) => {
    res.json({ data: await s.listBaselines(parseId(req.params['id'], 'Monitor')) });
  });
  r.post('/monitors/:id/baselines', op, async (req, res) => {
    res.status(201).json({ data: await s.createBaseline(parseId(req.params['id'], 'Monitor'), createBaselineSchema.parse(req.body ?? {})) });
  });
  r.post('/monitors/:id/baselines/:bid/approve', op, async (req, res) => {
    const b = reviewBaselineSchema.parse(req.body);
    res.json({ data: await s.reviewBaseline(parseId(req.params['id'], 'Monitor'), parseId(req.params['bid'], 'Baseline'), true, b.actor, b.note) });
  });
  r.post('/monitors/:id/baselines/:bid/reject', op, async (req, res) => {
    const b = reviewBaselineSchema.parse(req.body);
    res.json({ data: await s.reviewBaseline(parseId(req.params['id'], 'Monitor'), parseId(req.params['bid'], 'Baseline'), false, b.actor, b.note) });
  });
  r.get('/monitors/:id/mappings', async (req, res) => {
    res.json({ data: await s.listMappings(parseId(req.params['id'], 'Monitor')) });
  });
  r.post('/monitors/:id/mappings', op, async (req, res) => {
    res.status(201).json({ data: await s.createMapping(parseId(req.params['id'], 'Monitor'), createMappingSchema.parse(req.body)) });
  });
  r.delete('/monitors/:id/mappings/:mid', op, async (req, res) => {
    const { actor } = actorBody.parse(req.body ?? {});
    await s.deleteMapping(parseId(req.params['id'], 'Monitor'), parseId(req.params['mid'], 'Mapping'), actor);
    res.status(204).end();
  });
  r.get('/mappings', async (_req, res) => {
    res.json({ data: await s.listMappings() });
  });

  // incidents
  r.get('/incidents', async (req, res) => {
    const q = listIncidentsQuerySchema.parse(req.query);
    res.json({ data: await s.listIncidents(q) });
  });
  r.get('/incidents/:id', async (req, res) => {
    res.json({ data: await s.getIncident(parseId(req.params['id'], 'Incident')) });
  });
  r.patch('/incidents/:id', op, async (req, res) => {
    res.json({ data: await s.updateIncident(parseId(req.params['id'], 'Incident'), updateIncidentSchema.parse(req.body)) });
  });
  r.post('/incidents/:id/proposals', op, async (req, res) => {
    res.status(201).json({ data: await s.createProposal(parseId(req.params['id'], 'Incident'), createProposalSchema.parse(req.body ?? {})) });
  });

  // proposals
  r.get('/proposals', async (req, res) => {
    res.json({ data: await s.listProposals(listProposalsQuerySchema.parse(req.query)) });
  });
  r.get('/proposals/:id', async (req, res) => {
    res.json({ data: await s.getProposal(parseId(req.params['id'], 'Proposal')) });
  });
  r.post('/proposals/:id/validate', op, async (req, res) => {
    const { actor } = actorBody.parse(req.body ?? {});
    res.json({ data: await s.validateProposal(parseId(req.params['id'], 'Proposal'), actor) });
  });
  r.post('/proposals/:id/approve', op, async (req, res) => {
    const b = proposalActionSchema.parse(req.body);
    res.json({ data: await s.approveProposal(parseId(req.params['id'], 'Proposal'), b.actor, b.note) });
  });
  r.post('/proposals/:id/reject', op, async (req, res) => {
    const b = proposalActionSchema.parse(req.body);
    res.json({ data: await s.rejectProposal(parseId(req.params['id'], 'Proposal'), b.actor, b.note) });
  });
  r.post('/proposals/:id/promote', op, async (req, res) => {
    const b = proposalActionSchema.parse(req.body);
    res.json({ data: await s.promoteProposal(parseId(req.params['id'], 'Proposal'), b.actor) });
  });

  r.get('/audit', async (req, res) => {
    const q = listAuditQuerySchema.parse(req.query);
    res.json({ data: await s.listAudit(q.limit, q.entityType, q.q) });
  });
  return r;
}
