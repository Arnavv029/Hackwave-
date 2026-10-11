import { api } from './client';
import type { DemoCatalogDto, AuditDto, BaselineDto, CheckDto, CheckRunDto, CreateMonitorInput, IncidentDto, MappingDto, MonitorDto, MonitoringSettingsDto, OverviewDto, ProfileDto, ProposalDto, SettingsDto, TestConnectionDto, WhoamiDto } from './types';

type W<T> = { data: T };
const d = <T>(p: Promise<W<T>>): Promise<T> => p.then((b) => b.data);
const enc = encodeURIComponent;

export const guardian = {
  whoami: () => d(api<W<WhoamiDto>>('/api/auth/whoami')),
  overview: () => d(api<W<OverviewDto>>('/api/stats/overview')),
  settings: () => d(api<W<SettingsDto>>('/api/settings')),
  updateSettings: (body: { monitoring?: Partial<MonitoringSettingsDto>; profile?: Partial<ProfileDto>; actor: string }) => d(api<W<SettingsDto>>('/api/settings', { method: 'PUT', body })),

  monitors: {
    list: () => d(api<W<MonitorDto[]>>('/api/monitors')),
    get: (id: string) => d(api<W<MonitorDto>>(`/api/monitors/${enc(id)}`)),
    create: (body: CreateMonitorInput) => d(api<W<MonitorDto>>('/api/monitors', { method: 'POST', body })),
    update: (id: string, body: Record<string, unknown>) => d(api<W<MonitorDto>>(`/api/monitors/${enc(id)}`, { method: 'PATCH', body })),
    remove: (id: string, actor: string) => api<void>(`/api/monitors/${enc(id)}`, { method: 'DELETE', body: { actor } }),
    test: (body: { url: string; method: string; authType: 'NONE' | 'BEARER' | 'API_KEY' | 'BASIC'; authSecret?: string; authHeader?: string; headers?: Record<string, string>; body?: unknown; timeoutMs: number; monitorId?: string }, actor: string) =>
      d(api<W<TestConnectionDto>>('/api/monitors/test', { method: 'POST', body, query: { actor } })),
    check: (id: string, actor: string) => d(api<W<CheckRunDto>>(`/api/monitors/${enc(id)}/check`, { method: 'POST', body: { actor } })),
    pause: (id: string, actor: string) => d(api<W<MonitorDto>>(`/api/monitors/${enc(id)}/pause`, { method: 'POST', body: { actor } })),
    resume: (id: string, actor: string) => d(api<W<MonitorDto>>(`/api/monitors/${enc(id)}/resume`, { method: 'POST', body: { actor } })),
    rollbackAdapter: (id: string, actor: string, reason: string) => d(api<W<MonitorDto>>(`/api/monitors/${enc(id)}/adapter/rollback`, { method: 'POST', body: { actor, reason } })),
    checks: (id: string, limit = 50) => d(api<W<CheckDto[]>>(`/api/monitors/${enc(id)}/checks`, { query: { limit } })),
    baselines: (id: string) => d(api<W<BaselineDto[]>>(`/api/monitors/${enc(id)}/baselines`)),
    createBaseline: (id: string, body: { checkId?: string; actor: string; note?: string; approve?: boolean }) => d(api<W<BaselineDto>>(`/api/monitors/${enc(id)}/baselines`, { method: 'POST', body })),
    approveBaseline: (id: string, bid: string, actor: string, note?: string) => d(api<W<BaselineDto>>(`/api/monitors/${enc(id)}/baselines/${enc(bid)}/approve`, { method: 'POST', body: { actor, ...(note ? { note } : {}) } })),
    rejectBaseline: (id: string, bid: string, actor: string, note?: string) => d(api<W<BaselineDto>>(`/api/monitors/${enc(id)}/baselines/${enc(bid)}/reject`, { method: 'POST', body: { actor, ...(note ? { note } : {}) } })),
    mappings: (id: string) => d(api<W<MappingDto[]>>(`/api/monitors/${enc(id)}/mappings`)),
    addMapping: (id: string, body: { feature: string; jsonPath: string; route?: string; impactLevel?: string; description?: string; symptom?: string; createdBy: string }) => d(api<W<MappingDto>>(`/api/monitors/${enc(id)}/mappings`, { method: 'POST', body })),
    removeMapping: (id: string, mid: string, actor: string) => api<void>(`/api/monitors/${enc(id)}/mappings/${enc(mid)}`, { method: 'DELETE', body: { actor } }),
  },
  mappings: { list: () => d(api<W<MappingDto[]>>('/api/mappings')) },
  incidents: {
    list: (q: { monitorId?: string; status?: string; limit?: number } = {}) => d(api<W<IncidentDto[]>>('/api/incidents', { query: { ...q, limit: q.limit ?? 200 } })),
    get: (id: string) => d(api<W<IncidentDto>>(`/api/incidents/${enc(id)}`)),
    update: (id: string, body: { status?: 'OPEN' | 'INVESTIGATING' | 'AWAITING_FIX' | 'RESOLVED'; assignee?: string | null; note?: string; actor: string }) => d(api<W<IncidentDto>>(`/api/incidents/${enc(id)}`, { method: 'PATCH', body })),
    propose: (id: string, actor: string) => d(api<W<ProposalDto>>(`/api/incidents/${enc(id)}/proposals`, { method: 'POST', body: { actor } })),
  },
  proposals: {
    list: (q: { monitorId?: string; incidentId?: string; status?: string; limit?: number } = {}) => d(api<W<ProposalDto[]>>('/api/proposals', { query: { ...q, limit: q.limit ?? 200 } })),
    get: (id: string) => d(api<W<ProposalDto>>(`/api/proposals/${enc(id)}`)),
    validate: (id: string, actor: string) => d(api<W<ProposalDto>>(`/api/proposals/${enc(id)}/validate`, { method: 'POST', body: { actor } })),
    approve: (id: string, actor: string, note?: string) => d(api<W<ProposalDto>>(`/api/proposals/${enc(id)}/approve`, { method: 'POST', body: { actor, ...(note ? { note } : {}) } })),
    reject: (id: string, actor: string, note?: string) => d(api<W<ProposalDto>>(`/api/proposals/${enc(id)}/reject`, { method: 'POST', body: { actor, ...(note ? { note } : {}) } })),
    promote: (id: string, actor: string) => d(api<W<ProposalDto>>(`/api/proposals/${enc(id)}/promote`, { method: 'POST', body: { actor } })),
  },
  demo: {
    catalog: () => d(api<W<DemoCatalogDto>>('/api/demo/catalog')),
    registerAll: (actor: string, intervalSec = 30, keys?: string[]) => d(api<W<Array<{ key: string; monitorId: string; created: boolean; health: string }>>>('/api/demo/register-all', { method: 'POST', body: { actor, intervalSec, ...(keys ? { keys } : {}) } })),
    drift: (key: string) => d(api<W<unknown>>(`/api/demo/${enc(key)}/drift`, { method: 'POST' })),
    restore: (key: string) => d(api<W<unknown>>(`/api/demo/${enc(key)}/restore`, { method: 'POST' })),
    reset: (driftAfterSec?: number) => d(api<W<{ driftAfterMs: number }>>('/api/demo/reset', { method: 'POST', body: driftAfterSec === undefined ? {} : { driftAfterSec } })),
  },
  audit: { list: (limit = 300) => d(api<W<AuditDto[]>>('/api/audit', { query: { limit } })) },
  simulations: {
    list: (controlToken: string) => fetch('/api/simulations', { headers: { Authorization: `Bearer ${controlToken}` } }).then(async (r) => (r.ok ? ((await r.json()) as { active: Array<{ provider: string; scenario: string }>; catalog: Array<{ scenario: string; providers: string[] | 'all' }> }) : Promise.reject(new Error(`HTTP ${r.status}`)))),
    set: (controlToken: string, provider: string, scenario: string) =>
      fetch(scenario === 'baseline' ? `/api/simulations/${enc(provider)}` : `/api/simulations/${enc(provider)}/${enc(scenario)}`, { method: scenario === 'baseline' ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${controlToken}`, 'Content-Type': 'application/json' }, body: scenario === 'baseline' ? undefined : '{}' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
  },
};
