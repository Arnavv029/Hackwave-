import { describe, expect, it } from 'vitest';
import { intervalToSeconds, relativeTime, toIncident, toRecoveryProposal, toRegisteredApi } from '../src/api/mappers';
import type { IncidentDto, MonitorDto, ProposalDto } from '../src/api/types';

const monitor: MonitorDto = {
  id: 'm1', name: 'User API', url: 'https://api.example.com/users/1', method: 'GET', environment: 'Production', description: '', intervalSec: 300, interval: '5m', timeoutMs: 5000, authType: 'Bearer Token', authTypeCode: 'BEARER', authHeader: null, hasSecret: true, headers: {}, body: null, expectedStatus: null, autoBaseline: true, status: 'ACTIVE', health: 'Review Needed',
  lastCheckedAt: new Date(Date.now() - 120_000).toISOString(), nextRunAt: null, lastOutcome: 'SUCCESS', lastStatusCode: 200, lastLatencyMs: 142, lastError: null, lastParseOutcome: 'JSON', statusOnly: false, uptimePct: 99.4, checksCount: 20, baseline: null, pendingBaseline: null, baselineApproved: true, openIncidentCount: 1, openIncidentId: 'i1', hasIncident: true, activeProposalId: null,
  history: [{ time: '2026-10-11T12:00:00.000Z', latency: 138, status: 200, outcome: 'SUCCESS', changed: false }], createdBy: 'alice', createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z',
};

const incident: IncidentDto = {
  id: 'i1', monitorId: 'm1', apiId: 'm1', apiName: 'User API', environment: 'Production', endpoint: monitor.url, title: 'User API: field renamed (name -> display_name)', issueType: 'Schema drift', severity: 'Critical', status: 'Open', statusCode: 'OPEN', detectedAt: '2026-10-11T11:42:00.000Z', lastSeenAt: '2026-10-11T11:47:00.000Z', resolvedAt: null, occurrenceCount: 2, httpStatus: 200, latencyMs: 140,
  previousResponse: { id: 104, name: 'Aman Gupta' }, latestResponse: { id: 104, display_name: 'Aman Gupta' },
  diffs: [{ fieldName: 'name → display_name', changeType: 'renamed', expected: 'name: "Aman Gupta"', actual: 'display_name: "Aman Gupta"', path: 'name', newPath: 'display_name', evidence: null }, { fieldName: 'id', changeType: 'value_changed', expected: 'id: 1', actual: 'id: 2', path: 'id', newPath: null, evidence: null }],
  affectedFeatures: [{ mappingId: 'mp1', featureName: 'Profile card', apiName: 'User API', expectedField: 'name', jsonPath: '$.name', impactLevel: 'Critical', route: '/profile', description: 'Reads $.name', userFacingSymptom: 'Shows undefined', stillPresent: false, reason: 'name renamed to display_name' }],
  registeredMappings: [{ id: 'mp1', monitorId: 'm1', feature: 'Profile card', api: 'User API', jsonPath: '$.name', route: '/profile', impactLevel: 'Critical' }],
  proposalId: 'p1', proposalIds: ['p1'], assignee: null, note: null, statusChangedBy: 'system', baselineId: 'b1', checkId: 'c1',
};

const proposal: ProposalDto = {
  id: 'p1', incidentId: 'i1', incidentTitle: incident.title, monitorId: 'm1', apiName: 'User API', status: 'Promoted', statusCode: 'PROMOTED', proposedSolution: 'Expose display_name as name', adapterTransformation: '# adapter', transform: { version: 1, ops: [{ op: 'rename', from: '$.display_name', to: '$.name', removeSource: false, onConflict: 'reject' }] }, assumptions: ['a'], risks: ['r'], requiresManualReview: false, targetEnvironment: 'Staging', createdBy: 'system', createdAt: '2026-10-11T11:48:00.000Z', approver: 'bob', approvedAt: '2026-10-11T11:50:00.000Z', rejectedBy: null, promotedBy: 'carol', promotedAt: '2026-10-11T11:55:00.000Z', isActive: true,
  validationResult: { runId: 'VAL-1', testName: 't', targetWorkflow: 'Profile card', expectedResult: 'e', actualResult: 'a', status: 'Passed', latencyMs: 3, testTime: '2026-10-11T11:52:00.000Z', assertions: [{ rule: 'x', passed: true, expected: 'e', actual: 'a', mandatory: true }], logs: ['[RESULT] ok'], adaptedSample: {}, executedBy: 'alice' },
};

describe('mappers', () => {
  it('maps a monitor to the dashboard row shape', () => {
    const api = toRegisteredApi(monitor);
    expect(api.status).toBe('Review Needed');
    expect(api.responseTime).toBe('142ms');
    expect(api.lastChecked).toBe('2m ago');
    expect(api.uptime).toBe('99.4%');
    expect(api.hasIncident).toBe(true);
    expect(api.incidentId).toBe('i1');
    expect(api.history[0]).toEqual({ time: '12:00', latency: 138, status: 200 });
  });
  it('maps an incident, dropping informational value changes and keeping affected features', () => {
    const inc = toIncident(incident);
    expect(inc.diffs).toHaveLength(1);
    expect(inc.diffs?.[0]).toMatchObject({ changeType: 'renamed', fieldName: 'name → display_name' });
    expect(inc.previousResponse).toContain('"name": "Aman Gupta"');
    expect(inc.latestResponse).toContain('"display_name"');
    expect(inc.affectedFeatures?.[0]).toMatchObject({ featureName: 'Profile card', expectedField: 'name', impactLevel: 'Critical', affectedUsersPercentage: 'field missing' });
    expect(inc.detectedAt).toContain('2026');
    expect(inc.proposalId).toBe('p1');
  });
  it('maps proposal statuses to the UI vocabulary while keeping the exact label', () => {
    const p = toRecoveryProposal(proposal);
    expect(p.status).toBe('Approved');
    expect(p.statusLabel).toBe('Promoted');
    expect(p.isActive).toBe(true);
    expect(p.validationResult?.logs).toEqual(['[RESULT] ok']);
    expect(toRecoveryProposal({ ...proposal, status: 'Rolled Back', statusCode: 'ROLLED_BACK' }).status).toBe('Rejected');
    expect(toRecoveryProposal({ ...proposal, status: 'Pending', statusCode: 'PENDING' }).status).toBe('Pending');
  });
  it('parses intervals and relative times', () => {
    expect(intervalToSeconds('30s')).toBe(30);
    expect(intervalToSeconds('5m')).toBe(300);
    expect(intervalToSeconds('1h')).toBe(3600);
    expect(intervalToSeconds('5 minutes')).toBe(300);
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime(new Date().toISOString())).toBe('Just now');
  });
});
