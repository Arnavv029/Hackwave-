import type { AuditLogItem, Incident, MonitoringSettings, RecoveryProposal, RegisteredApi, UserProfile } from '../types';
import type { AuditDto, IncidentDto, MonitoringSettingsDto, ProfileDto, ProposalDto, MonitorDto } from './types';

/** Backend DTOs -> the UI's existing view models. Pure functions, unit tested. */

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'Just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).replace(',', ',') + ' UTC';
}

export function toRegisteredApi(m: MonitorDto, now = Date.now()): RegisteredApi {
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    method: m.method as RegisteredApi['method'],
    environment: m.environment as RegisteredApi['environment'],
    status: m.health,
    responseTime: m.lastLatencyMs === null ? '—' : `${m.lastLatencyMs}ms`,
    responseTimeNumeric: m.lastLatencyMs ?? 0,
    lastChecked: relativeTime(m.lastCheckedAt, now),
    hasIncident: m.hasIncident,
    incidentId: m.openIncidentId ?? undefined,
    baselineApproved: m.baselineApproved,
    interval: m.interval,
    timeout: m.timeoutMs,
    authType: m.authType as RegisteredApi['authType'],
    description: m.description,
    uptime: m.uptimePct === null ? '—' : `${m.uptimePct}%`,
    history: m.history.map((h) => ({ time: new Date(h.time).toISOString().slice(11, 16), latency: h.latency, status: h.status ?? 0 })),
    openIncidentCount: m.openIncidentCount,
    pendingBaselineId: m.pendingBaseline?.id,
    activeProposalId: m.activeProposalId,
    lastOutcome: m.lastOutcome,
    lastError: m.lastError,
    statusOnly: m.statusOnly,
  };
}

export function toIncident(i: IncidentDto): Incident {
  return {
    id: i.id,
    title: i.title,
    apiId: i.apiId,
    apiName: i.apiName,
    issueType: i.issueType as Incident['issueType'],
    severity: i.severity as Incident['severity'],
    status: i.status,
    detectedAt: formatDateTime(i.detectedAt),
    environment: (i.environment ?? undefined) as Incident['environment'],
    endpoint: i.endpoint ?? undefined,
    previousResponse: i.previousResponse === null || i.previousResponse === undefined ? '(no approved baseline snapshot)' : JSON.stringify(i.previousResponse, null, 2),
    latestResponse: i.latestResponse === null || i.latestResponse === undefined ? '(no body)' : JSON.stringify(i.latestResponse, null, 2),
    diffs: i.diffs.filter((d) => d.changeType !== 'value_changed').map((d) => ({ fieldName: d.fieldName, changeType: d.changeType as 'removed' | 'renamed' | 'type_mismatch' | 'added', expected: d.expected, actual: d.actual })),
    affectedFeatures: i.affectedFeatures.map((f) => ({ featureName: f.featureName, apiName: f.apiName, expectedField: f.expectedField, impactLevel: f.impactLevel as 'Critical' | 'High' | 'Medium' | 'Low', route: f.route, affectedUsersPercentage: f.stillPresent ? 'field still present' : 'field missing', description: f.description, userFacingSymptom: f.userFacingSymptom })),
    registeredMappings: i.registeredMappings.map((m) => ({ feature: m.feature, api: m.api, jsonPath: m.jsonPath })),
    proposalId: i.proposalId ?? undefined,
    occurrenceCount: i.occurrenceCount,
    lastSeenAt: formatDateTime(i.lastSeenAt),
    assignee: { name: i.assignee ?? 'Unassigned', role: i.statusChangedBy ? `last change by ${i.statusChangedBy}` : 'auto-detected' },
  };
}

export function toRecoveryProposal(p: ProposalDto): RecoveryProposal {
  const v = p.validationResult;
  return {
    id: p.id,
    incidentId: p.incidentId,
    incidentTitle: p.incidentTitle,
    apiName: p.apiName,
    proposedSolution: p.proposedSolution,
    adapterTransformation: p.adapterTransformation,
    assumptions: p.assumptions,
    risks: p.risks,
    status: p.status === 'Approved' || p.status === 'Promoted' ? 'Approved' : p.status === 'Rejected' || p.status === 'Rolled Back' ? 'Rejected' : 'Pending',
    statusLabel: p.status,
    isActive: p.isActive,
    requiresManualReview: p.requiresManualReview,
    promotedBy: p.promotedBy ?? undefined,
    createdBy: p.createdBy,
    approver: p.approver ?? undefined,
    createdAt: formatDateTime(p.createdAt),
    targetEnvironment: p.targetEnvironment as RecoveryProposal['targetEnvironment'],
    validationResult: v
      ? { runId: v.runId, testName: v.testName, targetWorkflow: v.targetWorkflow, expectedResult: v.expectedResult, actualResult: v.actualResult, status: v.status, latencyMs: v.latencyMs, testTime: formatDateTime(v.testTime), assertions: v.assertions.map((a) => ({ rule: a.rule, passed: a.passed, expected: a.expected, actual: a.actual })), errorDetails: v.errorDetails, logs: v.logs }
      : undefined,
  };
}

export function toAuditLogItem(a: AuditDto): AuditLogItem {
  return { id: a.id, timestamp: formatDateTime(a.timestamp), actor: a.actor, actorType: a.actorType, action: a.action, target: a.target, result: a.result, details: a.details, metadata: a.metadata };
}

export function toMonitoringSettings(s: MonitoringSettingsDto): MonitoringSettings {
  return { defaultInterval: s.defaultInterval, defaultTimeout: s.defaultTimeout, defaultEnvironment: s.defaultEnvironment as MonitoringSettings['defaultEnvironment'], alertSlack: s.alertSlack, alertEmail: s.alertEmail, alertPagerDuty: s.alertPagerDuty, ssrfProtection: s.ssrfProtection, autoBaseline: s.autoBaseline };
}

export function toUserProfile(p: ProfileDto): UserProfile {
  return { name: p.name, email: p.email, role: p.role, organization: p.organization };
}

export function intervalToSeconds(s: string): number {
  const m = /^(\d+)\s*(s|m|h|second|seconds|minute|minutes|hour|hours)?$/.exec(s.trim());
  if (!m) return 300;
  const n = Number(m[1]);
  const u = (m[2] ?? 'm')[0];
  return u === 's' ? n : u === 'h' ? n * 3600 : n * 60;
}
