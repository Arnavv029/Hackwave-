import type { Logger } from '../logger.js';
import type { ProviderClient } from '../observation/provider-client.js';
import type { HttpMethod } from '../providers/contracts.js';
import { extractFieldPaths, hashFieldPaths } from '../observation/shape.js';
import { redactValue } from '../security/redact.js';
import type { FieldPath } from '../observation/schemas.js';
import { diffFingerprint, diffResponses, type FieldChange, type ResponseDiff } from './diff.js';
import { applyAdapter, type AdapterOp, type AdapterSpec } from './adapter.js';
import { toFlatPath } from './jsonpath.js';
import { checkUrl } from './ssrf.js';
import type { SecretBox } from './secrets.js';
import type { GuardianEvents } from './events.js';
import type { MonitoringSettings } from './schemas.js';
import type { BaselineRecord, CheckRecord, GuardianStore, IncidentPatch, IncidentRecord, MappingRecord, MonitorRecord, NewProposal, ProposalRecord } from './store.js';

/**
 * The monitor engine: performs one check of a URL, compares the response with
 * the approved baseline, opens / updates / resolves incidents and drafts a
 * declarative adapter proposal. Every step is data-driven; nothing about a
 * particular provider or field name is built in.
 */

export interface EngineDeps {
  store: GuardianStore;
  client: ProviderClient;
  events: GuardianEvents;
  logger: Logger;
  secrets: SecretBox | null;
  /** Hard cap from the environment; when false private destinations are always refused. */
  allowPrivateNetworks: boolean;
  settings: () => Promise<MonitoringSettings>;
  maxResponseBytes: number;
  now?: () => Date;
}

/** A resolved incident whose fingerprint reappears within this window is reopened rather than duplicated. */
const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type CheckOutcome = 'SUCCESS' | 'HTTP_ERROR' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'TIMEOUT' | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE' | 'BLOCKED' | 'ERROR';

export interface ProbeInput {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  authType: 'NONE' | 'BEARER' | 'API_KEY' | 'BASIC';
  authSecret?: string | undefined;
  authHeader?: string | null | undefined;
  expectedStatus?: number | null | undefined;
}

export interface ProbeResult {
  outcome: CheckOutcome;
  statusCode: number | null;
  latencyMs: number;
  responseBytes: number;
  parseOutcome: 'JSON' | 'EMPTY' | 'NON_JSON' | 'MALFORMED_JSON' | 'TRUNCATED' | 'NOT_READ';
  /** Full parsed JSON body (redacted). Undefined when not JSON. */
  json: unknown;
  errorMessage: string | null;
  contentType: string | null;
  blocked: { reason: string } | null;
}

export interface CheckOutcomeReport {
  check: CheckRecord;
  monitor: MonitorRecord;
  baseline: BaselineRecord | null;
  diff: ResponseDiff | null;
  incident: IncidentRecord | null;
  proposal: ProposalRecord | null;
  resolvedIncidents: string[];
  baselineCreated: BaselineRecord | null;
}

const BODY_BOUNDS = { maxDepth: 12, maxArrayItems: 25, maxStringLength: 512, maxKeys: 300, maxSerializedBytes: 128 * 1024 };

/** Redact and bound a body without inserting marker values that would change its shape. */
export function prepareBody(value: unknown): unknown {
  const bound = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v.length > BODY_BOUNDS.maxStringLength ? v.slice(0, BODY_BOUNDS.maxStringLength) : v;
    if (v === null || typeof v !== 'object') return v;
    if (depth >= BODY_BOUNDS.maxDepth) return Array.isArray(v) ? [] : {};
    if (Array.isArray(v)) return v.slice(0, BODY_BOUNDS.maxArrayItems).map((x) => bound(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, BODY_BOUNDS.maxKeys)) out[k] = bound(x, depth + 1);
    return out;
  };
  let result = bound(redactValue(value), 0);
  let serialized = JSON.stringify(result) ?? 'null';
  let items = BODY_BOUNDS.maxArrayItems;
  while (Buffer.byteLength(serialized) > BODY_BOUNDS.maxSerializedBytes && items > 1) {
    items = Math.max(1, Math.floor(items / 2));
    const shrink = (v: unknown): unknown => (Array.isArray(v) ? v.slice(0, items).map(shrink) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x)])) : v);
    result = shrink(result);
    serialized = JSON.stringify(result) ?? 'null';
  }
  return result;
}

export class GuardianEngine {
  private readonly now: () => Date;
  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Build auth headers from the monitor configuration. */
  private authHeaders(input: Pick<ProbeInput, 'authType' | 'authSecret' | 'authHeader'>): Record<string, string> {
    if (input.authType === 'NONE' || !input.authSecret) return {};
    switch (input.authType) {
      case 'BEARER':
        return { authorization: `Bearer ${input.authSecret}` };
      case 'API_KEY':
        return { [(input.authHeader ?? 'X-API-Key').toLowerCase()]: input.authSecret };
      case 'BASIC':
        return { authorization: `Basic ${Buffer.from(input.authSecret, 'utf8').toString('base64')}` };
    }
  }

  /** One HTTP call, classified. Never throws for remote behaviour. */
  async probe(input: ProbeInput): Promise<ProbeResult> {
    const settings = await this.deps.settings();
    const verdict = await checkUrl(input.url, { allowPrivateNetworks: this.deps.allowPrivateNetworks && !settings.ssrfProtection });
    if (verdict.blocked) {
      return { outcome: 'BLOCKED', statusCode: null, latencyMs: 0, responseBytes: 0, parseOutcome: 'NOT_READ', json: undefined, errorMessage: verdict.reason ?? 'blocked', contentType: null, blocked: { reason: verdict.reason ?? 'blocked' } };
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v;
    Object.assign(headers, this.authHeaders(input));
    const res = await this.deps.client.call({ method: input.method, url: input.url, headers, ...(input.body !== undefined && input.body !== null ? { body: input.body } : {}), timeoutMs: input.timeoutMs, maxResponseBytes: this.deps.maxResponseBytes });
    const contentType = res.headers.find(([k]) => k === 'content-type')?.[1] ?? null;
    let outcome: CheckOutcome;
    let errorMessage: string | null = null;
    if (res.failure) {
      outcome = res.failure.category === 'TIMEOUT' ? 'TIMEOUT' : res.failure.category === 'CONNECTION_ERROR' ? 'NETWORK_ERROR' : res.failure.category === 'RESPONSE_TOO_LARGE' ? 'MALFORMED_RESPONSE' : 'ERROR';
      errorMessage = explainTransportError(res.failure.message, input.url);
    } else if (res.status === null) {
      outcome = 'NETWORK_ERROR';
      errorMessage = 'no HTTP response received';
    } else if (res.status === 429) outcome = 'RATE_LIMITED';
    else if (res.status === 503 || res.status === 502 || res.status === 504) outcome = 'UNAVAILABLE';
    else if (input.expectedStatus ? res.status !== input.expectedStatus : res.status >= 400) {
      outcome = 'HTTP_ERROR';
      errorMessage = input.expectedStatus ? `expected HTTP ${input.expectedStatus}, received ${res.status}` : `HTTP ${res.status}`;
    } else outcome = 'SUCCESS';

    let parseOutcome: ProbeResult['parseOutcome'];
    let json: unknown = undefined;
    if (res.truncated) parseOutcome = 'TRUNCATED';
    else if (!res.bodyText.trim()) parseOutcome = 'EMPTY';
    else {
      try {
        json = prepareBody(JSON.parse(res.bodyText));
        parseOutcome = 'JSON';
      } catch {
        parseOutcome = /json/i.test(contentType ?? '') ? 'MALFORMED_JSON' : 'NON_JSON';
        if (outcome === 'SUCCESS' && parseOutcome === 'MALFORMED_JSON') {
          outcome = 'MALFORMED_RESPONSE';
          errorMessage = 'response declared JSON but could not be parsed';
        }
      }
    }
    return { outcome, statusCode: res.status, latencyMs: res.latencyMs, responseBytes: res.bodyBytes, parseOutcome, json, errorMessage, contentType, blocked: null };
  }

  private secretOf(m: MonitorRecord): { secret?: string; error?: string } {
    if (m.authType === 'NONE' || !m.authSecretEnc) return {};
    if (!this.deps.secrets) return { error: 'MONITOR_SECRET_KEY is not configured; the stored credential cannot be decrypted' };
    try {
      return { secret: this.deps.secrets.decrypt(m.authSecretEnc) };
    } catch (err) {
      return { error: `credential could not be decrypted: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Full check: probe, persist, compare with the baseline, manage incidents and proposals. */
  async runCheck(monitorId: string, triggeredBy: string): Promise<CheckOutcomeReport> {
    const monitor = await this.deps.store.getMonitor(monitorId);
    if (!monitor) throw new Error(`monitor ${monitorId} not found`);
    const settings = await this.deps.settings();
    const checkedAt = this.now();
    const { secret, error: secretError } = this.secretOf(monitor);
    const probe: ProbeResult = secretError
      ? { outcome: 'ERROR', statusCode: null, latencyMs: 0, responseBytes: 0, parseOutcome: 'NOT_READ', json: undefined, errorMessage: secretError, contentType: null, blocked: null }
      : await this.probe({ url: monitor.url, method: monitor.method as HttpMethod, headers: monitor.headers, body: monitor.body ?? undefined, timeoutMs: monitor.timeoutMs, authType: monitor.authType, authSecret: secret, authHeader: monitor.authHeader, expectedStatus: monitor.expectedStatus });

    const fieldPaths: FieldPath[] | null = probe.parseOutcome === 'JSON' ? extractFieldPaths(probe.json) : null;
    let check = await this.deps.store.createCheck({
      monitorId,
      checkedAt,
      outcome: probe.outcome,
      statusCode: probe.statusCode,
      latencyMs: probe.latencyMs,
      responseBytes: probe.responseBytes,
      parseOutcome: probe.parseOutcome,
      bodySample: probe.json ?? null,
      fieldPaths,
      shapeHash: fieldPaths ? hashFieldPaths(fieldPaths) : null,
      errorMessage: probe.errorMessage,
      diff: null,
      adapted: false,
      incidentId: null,
      triggeredBy,
    });

    const baseline = await this.deps.store.approvedBaseline(monitorId);
    const mappings = await this.deps.store.listMappings(monitorId);
    const report: CheckOutcomeReport = { check, monitor, baseline, diff: null, incident: null, proposal: null, resolvedIncidents: [], baselineCreated: null };

    if (probe.outcome !== 'SUCCESS') {
      report.incident = await this.upsertAvailabilityIncident(monitor, check, baseline, probe, mappings);
      check = await this.deps.store.updateCheck(check.id, { incidentId: report.incident.id });
      report.check = check;
    } else if (probe.parseOutcome !== 'JSON') {
      // Healthy but not JSON: nothing to compare structurally. Resolve availability incidents.
      report.resolvedIncidents = await this.resolveIncidents(monitorId, (i) => isAvailability(i), 'endpoint responded successfully again');
    } else if (!baseline) {
      const pending = (await this.deps.store.listBaselines(monitorId)).find((b) => b.status === 'PENDING');
      if (monitor.autoBaseline || !pending) {
        const created = await this.deps.store.createBaseline({
          monitorId,
          status: monitor.autoBaseline ? 'APPROVED' : 'PENDING',
          checkId: check.id,
          statusCode: probe.statusCode,
          latencyMs: probe.latencyMs,
          snapshot: probe.json,
          fieldPaths: fieldPaths ?? [],
          shapeHash: check.shapeHash ?? '',
          approvedBy: monitor.autoBaseline ? 'system' : null,
          approvedAt: monitor.autoBaseline ? checkedAt : null,
          note: monitor.autoBaseline ? 'first successful JSON response approved automatically (monitor setting)' : 'first successful JSON response; awaiting approval',
        });
        report.baselineCreated = created;
        report.baseline = created.status === 'APPROVED' ? created : null;
        await this.deps.store.appendAudit({ actorType: 'SYSTEM', actorId: 'system', action: created.status === 'APPROVED' ? 'baseline.approved' : 'baseline.created', entityType: 'MONITOR_BASELINE', entityId: created.id, details: { target: monitor.name, monitorId, version: created.version, result: 'Success', summary: created.status === 'APPROVED' ? `First successful response committed automatically as baseline v${created.version} (${(fieldPaths ?? []).length} fields).` : `Baseline v${created.version} captured from the first successful response and is awaiting approval.`, fields: (fieldPaths ?? []).length, statusCode: probe.statusCode } });
        this.deps.events.emit(created.status === 'APPROVED' ? 'baseline.approved' : 'baseline.created', { monitorId, baselineId: created.id, version: created.version });
      }
      report.resolvedIncidents = await this.resolveIncidents(monitorId, (i) => isAvailability(i), 'endpoint responded successfully again');
    } else {
      // Compare (through the active adapter when one is promoted).
      let body = probe.json;
      let adapted = false;
      let adapterErrors: string[] = [];
      if (monitor.activeProposalId) {
        const active = await this.deps.store.getProposal(monitor.activeProposalId);
        if (active) {
          const res = applyAdapter(active.transform, probe.json);
          adapterErrors = res.errors;
          if (res.ok) {
            body = res.output;
            adapted = true;
          }
        }
      }
      const diff = diffResponses(baseline.snapshot, body, { renameThreshold: settings.renameThreshold, volatileFields: settings.volatileFields });
      report.diff = diff;
      check = await this.deps.store.updateCheck(check.id, { diff, adapted });
      report.check = check;
      const additiveIncident = settings.incidentOnAdditive && !diff.breaking && diff.counts.added > 0;
      if (diff.breaking || additiveIncident || adapterErrors.length) {
        const { incident, proposal } = await this.upsertDriftIncident(monitor, check, baseline, diff, probe, mappings, adapterErrors);
        report.incident = incident;
        report.proposal = proposal;
        check = await this.deps.store.updateCheck(check.id, { incidentId: incident.id });
        report.check = check;
        // A drift incident replaces availability incidents.
        report.resolvedIncidents = await this.resolveIncidents(monitorId, (i) => isAvailability(i), 'endpoint responded successfully again');
      } else {
        report.resolvedIncidents = await this.resolveIncidents(monitorId, () => true, adapted ? 'response matches the baseline after the promoted adapter' : 'response matches the baseline again');
      }
    }

    const updated = await this.deps.store.updateMonitor(monitorId, { lastCheckedAt: checkedAt, lastOutcome: probe.outcome, lastStatusCode: probe.statusCode, lastLatencyMs: probe.latencyMs, nextRunAt: new Date(checkedAt.getTime() + monitor.intervalSec * 1_000) });
    report.monitor = updated;
    this.deps.events.emit('check.completed', { monitorId, checkId: check.id, outcome: probe.outcome, statusCode: probe.statusCode, latencyMs: probe.latencyMs, incidentId: report.incident?.id ?? null, breaking: report.diff?.breaking ?? false });
    return report;
  }

  private async resolveIncidents(monitorId: string, predicate: (i: IncidentRecord) => boolean, reason: string): Promise<string[]> {
    const open = await this.deps.store.listIncidents({ monitorId, limit: 200 });
    const resolved: string[] = [];
    for (const inc of open) {
      if (inc.status === 'RESOLVED' || !predicate(inc)) continue;
      await this.deps.store.updateIncident(inc.id, { status: 'RESOLVED', resolvedAt: this.now(), statusChangedBy: 'system', note: reason });
      await this.deps.store.appendAudit({ actorType: 'SYSTEM', actorId: 'system', action: 'incident.resolved', entityType: 'MONITOR_INCIDENT', entityId: inc.id, details: { target: inc.title, monitorId, result: 'Success', summary: `Incident auto-resolved: ${reason}.` } });
      this.deps.events.emit('incident.resolved', { incidentId: inc.id, monitorId, reason });
      resolved.push(inc.id);
    }
    return resolved;
  }

  /**
   * The same failure returning shortly after it was resolved (e.g. the provider
   * flips back, or the backend restarted) reopens the existing incident instead
   * of creating a new one, so the incident list stays one row per real problem.
   */
  private async reopenIncident(prev: IncidentRecord, monitor: MonitorRecord, patch: Omit<IncidentPatch, 'status' | 'resolvedAt' | 'lastSeenAt' | 'occurrenceCount' | 'statusChangedBy'>): Promise<IncidentRecord> {
    const inc = await this.deps.store.updateIncident(prev.id, { ...patch, status: 'OPEN', resolvedAt: null, lastSeenAt: this.now(), occurrenceCount: prev.occurrenceCount + 1, statusChangedBy: 'system' });
    await this.deps.store.appendAudit({ actorType: 'SYSTEM', actorId: 'system', action: 'incident.reopened', entityType: 'MONITOR_INCIDENT', entityId: inc.id, details: { target: monitor.name, monitorId: monitor.id, result: 'Failure', summary: `Incident reopened: the same problem returned (${inc.occurrenceCount} occurrences).`, issueType: inc.issueType, severity: inc.severity } });
    this.deps.events.emit('incident.opened', { incidentId: inc.id, monitorId: monitor.id, issueType: inc.issueType, severity: inc.severity, reopened: true });
    return inc;
  }

  private async upsertAvailabilityIncident(monitor: MonitorRecord, check: CheckRecord, baseline: BaselineRecord | null, probe: ProbeResult, mappings: MappingRecord[]): Promise<IncidentRecord> {
    const issueType = probe.outcome === 'TIMEOUT' ? 'Timeout' : 'HTTP error';
    const fingerprint = `availability:${probe.outcome}:${probe.statusCode ?? 'none'}`;
    const title = probe.outcome === 'TIMEOUT' ? `${monitor.name}: request timed out after ${monitor.timeoutMs}ms` : probe.outcome === 'BLOCKED' ? `${monitor.name}: destination blocked by SSRF guard` : probe.statusCode ? `${monitor.name}: HTTP ${probe.statusCode} ${probe.outcome.toLowerCase().replace('_', ' ')}` : `${monitor.name}: ${probe.outcome.toLowerCase().replace('_', ' ')}${probe.errorMessage ? ` (${probe.errorMessage})` : ''}`;
    const latest = probe.json ?? { error: probe.errorMessage ?? probe.outcome, status: probe.statusCode, outcome: probe.outcome };
    const diffs: FieldChange[] = baseline ? [{ changeType: 'removed', path: '$', expected: `HTTP ${baseline.statusCode ?? '2xx'} with ${baseline.fieldPaths.length} fields`, actual: probe.statusCode ? `HTTP ${probe.statusCode}` : probe.outcome }] : [];
    const existing = await this.deps.store.findOpenIncident(monitor.id, fingerprint);
    if (existing) {
      const inc = await this.deps.store.updateIncident(existing.id, { lastSeenAt: this.now(), occurrenceCount: existing.occurrenceCount + 1, latestResponse: latest, checkId: check.id, statusCode: probe.statusCode, latencyMs: probe.latencyMs });
      this.deps.events.emit('incident.updated', { incidentId: inc.id, monitorId: monitor.id, occurrenceCount: inc.occurrenceCount });
      return inc;
    }
    const recent = await this.deps.store.findRecentlyResolvedIncident(monitor.id, fingerprint, new Date(this.now().getTime() - REOPEN_WINDOW_MS));
    if (recent) return this.reopenIncident(recent, monitor, { latestResponse: latest, checkId: check.id, statusCode: probe.statusCode, latencyMs: probe.latencyMs });
    const inc = await this.deps.store.createIncident({ monitorId: monitor.id, baselineId: baseline?.id ?? null, checkId: check.id, fingerprint, title, issueType, severity: probe.outcome === 'RATE_LIMITED' ? 'High' : 'Critical', status: 'OPEN', previousResponse: baseline?.snapshot ?? null, latestResponse: latest, diffs, statusCode: probe.statusCode, latencyMs: probe.latencyMs, assignee: null, statusChangedBy: 'system', note: probe.errorMessage });
    await this.deps.store.appendAudit({ actorType: 'SYSTEM', actorId: 'system', action: 'incident.opened', entityType: 'MONITOR_INCIDENT', entityId: inc.id, details: { target: monitor.name, monitorId: monitor.id, result: 'Failure', summary: title, issueType, severity: inc.severity, affectedFeatures: mappings.map((m) => m.feature) } });
    this.deps.events.emit('incident.opened', { incidentId: inc.id, monitorId: monitor.id, issueType, severity: inc.severity });
    return inc;
  }

  private async upsertDriftIncident(monitor: MonitorRecord, check: CheckRecord, baseline: BaselineRecord, diff: ResponseDiff, probe: ProbeResult, mappings: MappingRecord[], adapterErrors: string[]): Promise<{ incident: IncidentRecord; proposal: ProposalRecord | null }> {
    const structural = diff.changes.filter((c) => c.changeType !== 'value_changed');
    const affected = affectedMappings(mappings, structural);
    const issueType = diff.counts.removed > 0 ? 'Field removed' : diff.counts.type_mismatch > 0 ? 'Type changed' : 'Schema drift';
    const severity = adapterErrors.length ? 'Critical' : affected.some((m) => m.impactLevel === 'Critical') ? 'Critical' : affected.length > 0 ? 'Critical' : diff.breaking ? 'High' : 'Low';
    const fingerprint = `drift:${diffFingerprint(diff)}${adapterErrors.length ? ':adapter-error' : ''}`;
    const title = adapterErrors.length ? `${monitor.name}: promoted adapter failed (${adapterErrors[0]})` : describeTitle(monitor.name, diff);
    const existing = await this.deps.store.findOpenIncident(monitor.id, fingerprint);
    if (existing) {
      const inc = await this.deps.store.updateIncident(existing.id, { lastSeenAt: this.now(), occurrenceCount: existing.occurrenceCount + 1, latestResponse: probe.json, checkId: check.id, diffs: diff.changes, statusCode: probe.statusCode, latencyMs: probe.latencyMs });
      this.deps.events.emit('incident.updated', { incidentId: inc.id, monitorId: monitor.id, occurrenceCount: inc.occurrenceCount });
      const proposal = (await this.deps.store.listProposals({ incidentId: inc.id, limit: 1 }))[0] ?? null;
      return { incident: inc, proposal };
    }
    const recent = await this.deps.store.findRecentlyResolvedIncident(monitor.id, fingerprint, new Date(this.now().getTime() - REOPEN_WINDOW_MS));
    if (recent) {
      const inc = await this.reopenIncident(recent, monitor, { latestResponse: probe.json, checkId: check.id, diffs: diff.changes, statusCode: probe.statusCode, latencyMs: probe.latencyMs });
      const proposal = (await this.deps.store.listProposals({ incidentId: inc.id, limit: 1 }))[0] ?? null;
      return { incident: inc, proposal };
    }
    const inc = await this.deps.store.createIncident({ monitorId: monitor.id, baselineId: baseline.id, checkId: check.id, fingerprint, title, issueType, severity, status: 'OPEN', previousResponse: baseline.snapshot, latestResponse: probe.json, diffs: diff.changes, statusCode: probe.statusCode, latencyMs: probe.latencyMs, assignee: null, statusChangedBy: 'system', note: adapterErrors.length ? adapterErrors.join('; ') : null });
    await this.deps.store.appendAudit({ actorType: 'SYSTEM', actorId: 'system', action: 'incident.opened', entityType: 'MONITOR_INCIDENT', entityId: inc.id, details: { target: monitor.name, monitorId: monitor.id, result: 'Failure', summary: `Detected ${issueType.toLowerCase()}: ${summarizeChanges(structural)}.`, issueType, severity, changes: structural.map((c) => `${c.changeType}:${c.path}${c.newPath ? `>${c.newPath}` : ''}`), affectedFeatures: affected.map((m) => m.feature) } });
    this.deps.events.emit('incident.opened', { incidentId: inc.id, monitorId: monitor.id, issueType, severity });
    let proposal: ProposalRecord | null = null;
    if (!adapterErrors.length && diff.breaking) {
      proposal = await this.deps.store.createProposal(buildProposal(monitor, inc, diff, mappings, 'system'));
      await this.deps.store.appendAudit({ actorType: 'SYSTEM', actorId: 'system', action: 'proposal.created', entityType: 'RECOVERY_PROPOSAL', entityId: proposal.id, details: { target: `${inc.title}`, monitorId: monitor.id, incidentId: inc.id, result: 'Success', summary: proposal.requiresManualReview ? 'Recovery proposal drafted: manual review required (no safe automatic mapping).' : `Recovery proposal drafted: ${proposal.transform.ops.length} declarative operation(s).`, ops: proposal.transform.ops.map((o) => o.op) } });
      this.deps.events.emit('proposal.created', { proposalId: proposal.id, incidentId: inc.id, monitorId: monitor.id });
    }
    return { incident: inc, proposal };
  }
}

/** Turn raw socket/TLS errors into something an operator can act on. */
export function explainTransportError(message: string, url: string): string {
  const m = message.toLowerCase();
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  if (m.includes('wrong version number') || m.includes('tls_validate_record_header')) return `TLS handshake failed: ${host} answered with plain HTTP on an https:// URL. Use http:// for this endpoint (or enable TLS on the server). Raw error: ${message.split('\n')[0]}`;
  if (m.includes('certificate') || m.includes('self signed') || m.includes('self-signed') || m.includes('unable to verify')) return `TLS certificate for ${host} is not trusted (self-signed or wrong host). Raw error: ${message.split('\n')[0]}`;
  if (m.includes('econnrefused')) return `Connection refused by ${host}: nothing is listening on that host and port.`;
  if (m.includes('enotfound') || m.includes('eai_again')) return `DNS lookup failed for ${host}: the hostname does not resolve.`;
  if (m.includes('econnreset') || m.includes('other side closed')) return `${host} closed the connection before answering (connection reset).`;
  if (m.includes('ehostunreach') || m.includes('enetunreach')) return `${host} is unreachable from this network.`;
  return message;
}

export function isAvailability(i: IncidentRecord): boolean {
  return i.issueType === 'HTTP error' || i.issueType === 'Timeout';
}

/** Mappings whose JSON path is touched by one of the structural changes. */
export function affectedMappings(mappings: MappingRecord[], changes: FieldChange[]): Array<MappingRecord & { change: FieldChange }> {
  const out: Array<MappingRecord & { change: FieldChange }> = [];
  for (const m of mappings) {
    let flat: string;
    try {
      flat = toFlatPath(m.jsonPath);
    } catch {
      continue;
    }
    const hit = changes.find((c) => c.changeType !== 'added' && (c.path === '$' || c.path === flat || flat.startsWith(`${c.path}.`) || flat.startsWith(`${c.path}[]`)));
    if (hit) out.push({ ...m, change: hit });
  }
  return out;
}

export function summarizeChanges(changes: FieldChange[]): string {
  const parts: string[] = [];
  for (const c of changes.slice(0, 6)) {
    if (c.changeType === 'renamed') parts.push(`${c.path} -> ${c.newPath}`);
    else if (c.changeType === 'type_mismatch') parts.push(`${c.path} type ${(c.baselineTypes ?? []).join('|')} -> ${(c.currentTypes ?? []).join('|')}`);
    else parts.push(`${c.changeType} ${c.path}`);
  }
  if (changes.length > 6) parts.push(`+${changes.length - 6} more`);
  return parts.join(', ') || 'no structural change';
}

function describeTitle(name: string, diff: ResponseDiff): string {
  const renamed = diff.changes.filter((c) => c.changeType === 'renamed');
  const removed = diff.changes.filter((c) => c.changeType === 'removed');
  const typed = diff.changes.filter((c) => c.changeType === 'type_mismatch');
  if (removed.length && !renamed.length && !typed.length) return `${name}: field removed (${removed.map((c) => c.path).join(', ')})`;
  if (renamed.length && !removed.length && !typed.length) return `${name}: field renamed (${renamed.map((c) => `${c.path} -> ${c.newPath}`).join(', ')})`;
  if (typed.length && !removed.length && !renamed.length) return `${name}: type changed (${typed.map((c) => `${c.path}: ${(c.baselineTypes ?? []).join('|')} -> ${(c.currentTypes ?? []).join('|')}`).join(', ')})`;
  if (!diff.breaking) return `${name}: new fields added (${diff.changes.filter((c) => c.changeType === 'added').map((c) => c.path).join(', ')})`;
  return `${name}: schema drift (${summarizeChanges(diff.changes.filter((c) => c.changeType !== 'value_changed'))})`;
}

const COERCIBLE: Record<string, Array<'string' | 'number' | 'boolean'>> = { string: ['number', 'boolean'], number: ['string'], boolean: ['string'] };

/** Derive a declarative adapter proposal from a diff. Pure. */
export function buildProposal(monitor: MonitorRecord, incident: IncidentRecord, diff: ResponseDiff, mappings: MappingRecord[], createdBy: string): NewProposal {
  const ops: AdapterOp[] = [];
  const assumptions: string[] = [];
  const risks: string[] = [];
  const unresolved: string[] = [];
  for (const c of diff.changes) {
    if (c.changeType === 'renamed' && c.newPath && c.evidence?.childOverlap !== null && c.evidence?.childOverlap !== undefined && c.evidence.childOverlap < 1) {
      // A renamed container whose children also changed cannot be restored by moving it back; a human must map the inside.
      unresolved.push(`${c.path} moved to ${c.newPath} but its inner fields differ (structure overlap ${Math.round(c.evidence.childOverlap * 100)}%)`);
    } else if (c.changeType === 'renamed' && c.newPath) {
      ops.push({ op: 'rename', from: `$.${c.newPath}`, to: `$.${c.path}`, removeSource: false, onConflict: 'reject' });
      assumptions.push(`\`${c.newPath}\` carries the same meaning as the former \`${c.path}\` (name similarity ${c.evidence?.nameSimilarity ?? 'n/a'}, same value in both samples: ${c.evidence?.valueMatch ? 'yes' : 'no'}${c.evidence?.singleSwap ? ', only swap in its object' : ''}).`);
      risks.push(`If the provider ever returns both \`${c.path}\` and \`${c.newPath}\` with different values the adapter rejects the response instead of guessing.`);
    } else if (c.changeType === 'type_mismatch') {
      const from = (c.currentTypes ?? []).filter((t) => t !== 'null')[0];
      const to = (c.baselineTypes ?? []).filter((t) => t !== 'null')[0];
      if (from && to && (COERCIBLE[from] ?? []).includes(to as 'string' | 'number' | 'boolean') && c.path !== '$') {
        ops.push({ op: 'coerce', path: `$.${c.path}`, toType: to as 'string' | 'number' | 'boolean' });
        assumptions.push(`\`${c.path}\` values are lossless ${to} literals encoded as ${from}.`);
        risks.push(`A value of \`${c.path}\` that is not a clean ${to} makes the adapter reject the response.`);
      } else unresolved.push(`${c.path} changed type ${(c.baselineTypes ?? []).join('|')} -> ${(c.currentTypes ?? []).join('|')}`);
    } else if (c.changeType === 'removed') {
      unresolved.push(`${c.path} disappeared with no plausible replacement`);
    }
  }
  const affected = affectedMappings(mappings, diff.changes.filter((c) => c.changeType !== 'value_changed'));
  if (affected.length) risks.push(`Registered features read the changed fields: ${affected.map((m) => `${m.feature} (${m.jsonPath})`).join(', ')}.`);
  risks.push('The adapter restores the contract for consumers; the upstream change itself remains and should be confirmed with the provider.');
  const requiresManualReview = ops.length === 0 || unresolved.length > 0;
  if (unresolved.length) assumptions.push(`Manual review needed: ${unresolved.join('; ')}.`);
  const transform: AdapterSpec = { version: 1, ops };
  const proposedSolution = ops.length
    ? `Apply a backwards-compatible response adapter for ${monitor.name}: ${ops.map((o) => (o.op === 'rename' ? `expose ${o.from.slice(2)} as ${o.to.slice(2)}` : o.op === 'coerce' ? `coerce ${o.path.slice(2)} to ${o.toType}` : `default ${o.path.slice(2)}`)).join('; ')}. Existing fields are preserved${unresolved.length ? `; ${unresolved.length} change(s) still need a human decision` : ''}.`
    : `No safe automatic mapping for ${monitor.name}: ${unresolved.join('; ') || 'the change cannot be expressed as a declarative transform'}. A human must decide how downstream consumers should handle it.`;
  return { incidentId: incident.id, monitorId: monitor.id, status: 'PENDING', proposedSolution, transform, assumptions, risks, requiresManualReview, targetEnvironment: monitor.environment === 'Production' ? 'Staging' : monitor.environment, createdBy };
}
