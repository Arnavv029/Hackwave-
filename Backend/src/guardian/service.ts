import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../errors.js';
import { adapterSpecSchema, applyAdapter, describeAdapter, type AdapterSpec } from './adapter.js';
import { diffResponses } from './diff.js';
import { affectedMappings, buildProposal, isAvailability, type GuardianEngine, type ProbeResult } from './engine.js';
import type { GuardianEvents } from './events.js';
import { jsonPathExists, parseJsonPath, resolveJsonPath } from './jsonpath.js';
import { intervalToSeconds, monitoringSettingsSchema, profileSchema, secondsToInterval, type CreateMappingInput, type CreateMonitorInput, type MonitoringSettings, type Profile, type TestConnectionInput, type UpdateMonitorInput } from './schemas.js';
import type { SecretBox } from './secrets.js';
import type { AuditRecord, BaselineRecord, CheckRecord, GuardianStore, IncidentRecord, IncidentStatus, MappingRecord, MonitorRecord, ProposalRecord, ValidationAssertion, ValidationResult } from './store.js';
import { jsonTypeOf } from '../observation/shape.js';

/** Application service: CRUD, wire shapes for the dashboard, validation, stats. */

export interface GuardianServiceDeps {
  store: GuardianStore;
  engine: GuardianEngine;
  events: GuardianEvents;
  secrets: SecretBox | null;
  logger: Logger;
  env: { allowPrivateNetworks: boolean; schedulerEnabled: boolean; nodeEnv: string };
  now?: () => Date;
}

const SETTINGS_KEY = 'monitoring';
const PROFILE_KEY = 'profile';

const AUTH_LABEL: Record<MonitorRecord['authType'], string> = { NONE: 'None', BEARER: 'Bearer Token', API_KEY: 'API Key', BASIC: 'Basic Auth' };
const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = { OPEN: 'Open', INVESTIGATING: 'Investigating', AWAITING_FIX: 'Awaiting Fix', RESOLVED: 'Resolved' };
const PROPOSAL_STATUS_LABEL: Record<ProposalRecord['status'], string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', PROMOTED: 'Promoted', ROLLED_BACK: 'Rolled Back' };
const ACTION_LABEL: Record<string, string> = {
  'monitor.created': 'API dependency registered',
  'monitor.updated': 'Monitor configuration updated',
  'monitor.deleted': 'Monitor removed',
  'monitor.paused': 'Monitoring paused',
  'monitor.resumed': 'Monitoring resumed',
  'monitor.checked': 'Manual check executed',
  'baseline.created': 'Baseline captured',
  'baseline.approved': 'Baseline approved',
  'baseline.rejected': 'Baseline rejected',
  'incident.opened': 'Incident detected',
  'incident.updated': 'Incident updated',
  'incident.resolved': 'Incident resolved',
  'mapping.created': 'Feature mapping registered',
  'mapping.deleted': 'Feature mapping removed',
  'proposal.created': 'Repair proposal created',
  'proposal.validated': 'Validation test executed',
  'proposal.approved': 'Repair proposal approved',
  'proposal.rejected': 'Repair proposal rejected',
  'proposal.promoted': 'Adapter promoted to gateway',
  'proposal.rolled_back': 'Adapter rolled back',
  'settings.updated': 'Settings updated',
  'security.blocked': 'SSRF guard blocked destination',
};

export class GuardianService {
  private readonly now: () => Date;
  constructor(private readonly deps: GuardianServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  // --- settings ------------------------------------------------------------

  async monitoringSettings(): Promise<MonitoringSettings> {
    const stored = (await this.deps.store.getSetting<Partial<MonitoringSettings>>(SETTINGS_KEY)) ?? {};
    // Default for the SSRF toggle follows the environment: production (private networks disallowed) starts
    // protected; development starts open so local mock providers can be monitored. Operators can change it.
    const withDefault = { ssrfProtection: !this.deps.env.allowPrivateNetworks, ...stored };
    const parsed = monitoringSettingsSchema.safeParse(withDefault);
    return parsed.success ? parsed.data : monitoringSettingsSchema.parse({ ssrfProtection: !this.deps.env.allowPrivateNetworks });
  }
  async profile(): Promise<Profile> {
    const stored = (await this.deps.store.getSetting<Partial<Profile>>(PROFILE_KEY)) ?? {};
    const parsed = profileSchema.safeParse(stored);
    return parsed.success ? parsed.data : profileSchema.parse({});
  }
  async settings() {
    const [monitoring, profile] = await Promise.all([this.monitoringSettings(), this.profile()]);
    return { monitoring, profile, runtime: { allowPrivateNetworks: this.deps.env.allowPrivateNetworks, schedulerEnabled: this.deps.env.schedulerEnabled, secretsConfigured: this.deps.secrets !== null, nodeEnv: this.deps.env.nodeEnv } };
  }
  async updateSettings(input: { monitoring?: Partial<MonitoringSettings>; profile?: Partial<Profile>; actor: string }) {
    if (input.monitoring) {
      const next = monitoringSettingsSchema.parse({ ...(await this.monitoringSettings()), ...input.monitoring });
      await this.deps.store.setSetting(SETTINGS_KEY, next, input.actor);
    }
    if (input.profile) {
      const next = profileSchema.parse({ ...(await this.profile()), ...input.profile });
      await this.deps.store.setSetting(PROFILE_KEY, next, input.actor);
    }
    await this.audit('USER', input.actor, 'settings.updated', 'SETTINGS', '00000000-0000-0000-0000-000000000000', { target: Object.keys(input).filter((k) => k !== 'actor').join(', ') || 'settings', result: 'Success', summary: `Updated ${input.monitoring ? 'monitoring defaults' : ''}${input.monitoring && input.profile ? ' and ' : ''}${input.profile ? 'profile' : ''}.` });
    this.deps.events.emit('settings.updated', {});
    return this.settings();
  }

  // --- monitors ------------------------------------------------------------

  private encryptSecret(secret: string | undefined): string | null {
    if (!secret) return null;
    if (!this.deps.secrets) throw new UnprocessableError('Credentials cannot be stored: set MONITOR_SECRET_KEY on the backend to enable encrypted secret storage');
    return this.deps.secrets.encrypt(secret);
  }

  async createMonitor(input: CreateMonitorInput): Promise<ReturnType<GuardianService['monitorWire']> extends Promise<infer T> ? T : never> {
    const verdict = await this.deps.engine.probe({ url: input.url, method: input.method, headers: {}, timeoutMs: 1, authType: 'NONE' }).catch(() => null);
    void verdict; // URL syntax is validated by probe(); a network failure is fine at registration time.
    const rec = await this.deps.store.createMonitor({
      name: input.name,
      url: input.url,
      method: input.method,
      environment: input.environment,
      description: input.description,
      intervalSec: input.intervalSec,
      timeoutMs: input.timeoutMs,
      authType: input.authType,
      authHeader: input.authHeader ?? null,
      authSecretEnc: this.encryptSecret(input.authSecret),
      headers: input.headers,
      body: input.body ?? null,
      expectedStatus: input.expectedStatus ?? null,
      autoBaseline: input.autoBaseline,
      status: 'ACTIVE',
      createdBy: input.createdBy,
      nextRunAt: this.now(),
    });
    await this.audit('USER', input.createdBy, 'monitor.created', 'MONITOR', rec.id, { target: rec.name, result: 'Success', summary: `Configured ${rec.method} probe every ${secondsToInterval(rec.intervalSec)} on ${rec.environment}.`, endpoint: rec.url, timeoutMs: rec.timeoutMs, authType: rec.authType });
    this.deps.events.emit('monitor.created', { monitorId: rec.id });
    // First check right away so the dashboard shows real data immediately.
    const report = await this.deps.engine.runCheck(rec.id, input.createdBy).catch((err: unknown) => {
      this.deps.logger.warn({ err, monitorId: rec.id }, 'initial check failed');
      return null;
    });
    return this.monitorWire(report?.monitor ?? rec);
  }

  async updateMonitor(id: string, input: UpdateMonitorInput) {
    const cur = await this.mustMonitor(id);
    const { actor, authSecret, ...rest } = input;
    const patch: Parameters<GuardianStore['updateMonitor']>[1] = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    if (authSecret !== undefined) patch.authSecretEnc = this.encryptSecret(authSecret);
    if (input.authType === 'NONE') patch.authSecretEnc = null;
    if (input.intervalSec && input.intervalSec !== cur.intervalSec) patch.nextRunAt = new Date(this.now().getTime() + input.intervalSec * 1_000);
    const rec = await this.deps.store.updateMonitor(id, patch);
    await this.audit('USER', actor, 'monitor.updated', 'MONITOR', id, { target: rec.name, result: 'Success', summary: `Updated ${Object.keys(rest).join(', ') || 'credentials'}.` });
    this.deps.events.emit('monitor.updated', { monitorId: id });
    return this.monitorWire(rec);
  }

  async deleteMonitor(id: string, actor: string): Promise<void> {
    const cur = await this.mustMonitor(id);
    await this.deps.store.deleteMonitor(id);
    await this.audit('USER', actor, 'monitor.deleted', 'MONITOR', id, { target: cur.name, result: 'Success', summary: 'Monitor and its history removed.' });
    this.deps.events.emit('monitor.deleted', { monitorId: id });
  }

  async setPaused(id: string, paused: boolean, actor: string) {
    await this.mustMonitor(id);
    const rec = await this.deps.store.updateMonitor(id, { status: paused ? 'PAUSED' : 'ACTIVE', ...(paused ? {} : { nextRunAt: this.now() }) });
    await this.audit('USER', actor, paused ? 'monitor.paused' : 'monitor.resumed', 'MONITOR', id, { target: rec.name, result: 'Success', summary: paused ? 'Operator paused scheduled checks.' : 'Operator resumed scheduled checks.' });
    this.deps.events.emit('monitor.updated', { monitorId: id, status: rec.status });
    return this.monitorWire(rec);
  }

  async runCheck(id: string, actor: string) {
    await this.mustMonitor(id);
    const report = await this.deps.engine.runCheck(id, actor);
    await this.audit(actor === 'scheduler' ? 'SYSTEM' : 'USER', actor, 'monitor.checked', 'MONITOR', id, { target: report.monitor.name, result: report.check.outcome === 'SUCCESS' ? 'Success' : 'Failure', summary: `${report.check.outcome}${report.check.statusCode ? ` HTTP ${report.check.statusCode}` : ''} in ${report.check.latencyMs}ms${report.diff ? report.diff.identical ? '; matches baseline' : `; ${report.diff.changes.length} change(s)` : ''}.`, checkId: report.check.id });
    return { monitor: await this.monitorWire(report.monitor), check: this.checkWire(report.check), diff: report.diff, incidentId: report.incident?.id ?? null, proposalId: report.proposal?.id ?? null, baselineCreated: report.baselineCreated ? this.baselineWire(report.baselineCreated) : null, resolvedIncidents: report.resolvedIncidents };
  }

  async testConnection(input: TestConnectionInput, actor: string) {
    let secret = input.authSecret;
    let authType = input.authType;
    let authHeader = input.authHeader;
    if (!secret && input.monitorId) {
      const m = await this.mustMonitor(input.monitorId);
      if (m.authSecretEnc && this.deps.secrets) secret = this.deps.secrets.decrypt(m.authSecretEnc);
      authType = m.authType;
      authHeader = m.authHeader ?? undefined;
    }
    const probe: ProbeResult = await this.deps.engine.probe({ url: input.url, method: input.method, headers: input.headers, body: input.body, timeoutMs: input.timeoutMs, authType, authSecret: secret, authHeader, expectedStatus: null });
    if (probe.blocked) await this.audit('SYSTEM', 'ssrf-guard', 'security.blocked', 'SETTINGS', '00000000-0000-0000-0000-000000000000', { target: input.url, result: 'Failure', summary: probe.blocked.reason, requestedBy: actor });
    const fieldCount = probe.json !== undefined ? Object.keys(diffResponses(probe.json, probe.json).changes.length ? {} : flattenCount(probe.json)).length : 0;
    return { outcome: probe.outcome, status: probe.statusCode, latencyMs: probe.latencyMs, bytes: probe.responseBytes, parseOutcome: probe.parseOutcome, contentType: probe.contentType, preview: probe.json ?? null, error: probe.errorMessage, blocked: probe.blocked !== null, reason: probe.blocked?.reason ?? null, safe: probe.blocked === null && probe.outcome === 'SUCCESS', fieldCount };
  }

  async listMonitors(filter: { environment?: string; status?: string; q?: string } = {}) {
    const rows = await this.deps.store.listMonitors();
    const wires = await Promise.all(rows.map((m) => this.monitorWire(m)));
    return wires.filter((m) => (!filter.environment || m.environment === filter.environment) && (!filter.status || m.status === filter.status) && (!filter.q || `${m.name} ${m.url}`.toLowerCase().includes(filter.q.toLowerCase())));
  }
  async getMonitor(id: string) {
    return this.monitorWire(await this.mustMonitor(id));
  }
  async listChecks(id: string, limit: number) {
    await this.mustMonitor(id);
    return (await this.deps.store.listChecks(id, limit)).map((c) => this.checkWire(c));
  }

  // --- baselines -----------------------------------------------------------

  async listBaselines(id: string) {
    await this.mustMonitor(id);
    return (await this.deps.store.listBaselines(id)).map((b) => this.baselineWire(b, true));
  }
  async createBaseline(id: string, input: { checkId?: string | undefined; actor: string; note?: string | undefined; approve: boolean }) {
    const monitor = await this.mustMonitor(id);
    const check = input.checkId ? await this.deps.store.getCheck(input.checkId) : await this.deps.store.latestCheck(id);
    if (!check || check.monitorId !== id) throw new NotFoundError('Check not found for this monitor');
    if (check.parseOutcome !== 'JSON' || check.outcome !== 'SUCCESS') throw new UnprocessableError('Only a successful JSON response can become a baseline', { outcome: check.outcome, parseOutcome: check.parseOutcome });
    const b = await this.deps.store.createBaseline({ monitorId: id, status: input.approve ? 'APPROVED' : 'PENDING', checkId: check.id, statusCode: check.statusCode, latencyMs: check.latencyMs, snapshot: check.bodySample, fieldPaths: check.fieldPaths ?? [], shapeHash: check.shapeHash ?? '', approvedBy: input.approve ? input.actor : null, approvedAt: input.approve ? this.now() : null, note: input.note ?? null });
    await this.audit('USER', input.actor, input.approve ? 'baseline.approved' : 'baseline.created', 'MONITOR_BASELINE', b.id, { target: monitor.name, monitorId: id, version: b.version, result: 'Success', summary: `${input.approve ? 'Committed' : 'Captured'} baseline v${b.version} from check ${check.id.slice(0, 8)} (${b.fieldPaths.length} fields).`, baselineHash: `sha256:${b.shapeHash.slice(0, 16)}`, endpoint: monitor.url });
    this.deps.events.emit(input.approve ? 'baseline.approved' : 'baseline.created', { monitorId: id, baselineId: b.id, version: b.version });
    if (input.approve) await this.deps.engine.runCheck(id, input.actor).catch(() => undefined);
    return this.baselineWire(b, true);
  }
  async reviewBaseline(id: string, baselineId: string, approve: boolean, actor: string, note?: string) {
    const monitor = await this.mustMonitor(id);
    const b = await this.deps.store.getBaseline(baselineId);
    if (!b || b.monitorId !== id) throw new NotFoundError('Baseline not found');
    if (b.status !== 'PENDING') throw new ConflictError(`Baseline is ${b.status}; only PENDING baselines can be reviewed`);
    const next = await this.deps.store.updateBaseline(baselineId, { status: approve ? 'APPROVED' : 'REJECTED', approvedBy: actor, approvedAt: this.now(), note: note ?? b.note });
    await this.audit('USER', actor, approve ? 'baseline.approved' : 'baseline.rejected', 'MONITOR_BASELINE', baselineId, { target: monitor.name, monitorId: id, version: b.version, result: 'Success', summary: approve ? `Baseline v${b.version} approved as the golden schema reference.` : `Baseline v${b.version} rejected${note ? `: ${note}` : ''}.`, baselineHash: `sha256:${b.shapeHash.slice(0, 16)}` });
    this.deps.events.emit('baseline.approved', { monitorId: id, baselineId, approved: approve });
    if (approve) await this.deps.engine.runCheck(id, actor).catch(() => undefined);
    return this.baselineWire(next, true);
  }

  // --- mappings ------------------------------------------------------------

  async listMappings(monitorId?: string) {
    const rows = await this.deps.store.listMappings(monitorId);
    const monitors = new Map((await this.deps.store.listMonitors()).map((m) => [m.id, m]));
    return rows.map((m) => this.mappingWire(m, monitors.get(m.monitorId)?.name ?? m.monitorId));
  }
  async createMapping(monitorId: string, input: CreateMappingInput) {
    const monitor = await this.mustMonitor(monitorId);
    try {
      parseJsonPath(input.jsonPath);
    } catch (err) {
      throw new UnprocessableError(`Invalid JSON path: ${err instanceof Error ? err.message : String(err)}`);
    }
    const rec = await this.deps.store.createMapping({ monitorId, feature: input.feature, jsonPath: input.jsonPath, route: input.route ?? null, impactLevel: input.impactLevel, description: input.description ?? null, symptom: input.symptom ?? null, createdBy: input.createdBy });
    await this.audit('USER', input.createdBy, 'mapping.created', 'FEATURE_MAPPING', rec.id, { target: `${input.feature} → ${input.jsonPath}`, monitorId, result: 'Success', summary: `Feature "${input.feature}" depends on ${input.jsonPath} of ${monitor.name}.` });
    this.deps.events.emit('mapping.changed', { monitorId });
    return this.mappingWire(rec, monitor.name);
  }
  async deleteMapping(monitorId: string, mappingId: string, actor: string): Promise<void> {
    const m = await this.deps.store.getMapping(mappingId);
    if (!m || m.monitorId !== monitorId) throw new NotFoundError('Mapping not found');
    await this.deps.store.deleteMapping(mappingId);
    await this.audit('USER', actor, 'mapping.deleted', 'FEATURE_MAPPING', mappingId, { target: `${m.feature} → ${m.jsonPath}`, monitorId, result: 'Success', summary: 'Feature mapping removed.' });
    this.deps.events.emit('mapping.changed', { monitorId });
  }

  // --- incidents -----------------------------------------------------------

  async listIncidents(filter: { monitorId?: string; status?: IncidentStatus; severity?: string; limit: number }) {
    const rows = await this.deps.store.listIncidents(filter);
    return Promise.all(rows.map((i) => this.incidentWire(i)));
  }
  async getIncident(id: string) {
    const i = await this.deps.store.getIncident(id);
    if (!i) throw new NotFoundError('Incident not found');
    return this.incidentWire(i);
  }
  async updateIncident(id: string, input: { status?: IncidentStatus | undefined; assignee?: string | null | undefined; note?: string | undefined; actor: string }) {
    const cur = await this.deps.store.getIncident(id);
    if (!cur) throw new NotFoundError('Incident not found');
    const patch: Parameters<GuardianStore['updateIncident']>[1] = {};
    if (input.status && input.status !== cur.status) {
      patch.status = input.status;
      patch.statusChangedBy = input.actor;
      patch.resolvedAt = input.status === 'RESOLVED' ? this.now() : null;
    }
    if (input.assignee !== undefined) patch.assignee = input.assignee;
    if (input.note !== undefined) patch.note = input.note;
    const next = await this.deps.store.updateIncident(id, patch);
    await this.audit('USER', input.actor, input.status === 'RESOLVED' ? 'incident.resolved' : 'incident.updated', 'MONITOR_INCIDENT', id, { target: cur.title, monitorId: cur.monitorId, result: 'Success', summary: `${input.status ? `Status changed to ${INCIDENT_STATUS_LABEL[input.status]}` : 'Incident updated'}${input.note ? `: ${input.note}` : ''}.` });
    this.deps.events.emit(input.status === 'RESOLVED' ? 'incident.resolved' : 'incident.updated', { incidentId: id, monitorId: cur.monitorId });
    return this.incidentWire(next);
  }

  // --- proposals -----------------------------------------------------------

  async listProposals(filter: { monitorId?: string; incidentId?: string; status?: ProposalRecord['status']; limit: number }) {
    const rows = await this.deps.store.listProposals(filter);
    return Promise.all(rows.map((p) => this.proposalWire(p)));
  }
  async getProposal(id: string) {
    return this.proposalWire(await this.mustProposal(id));
  }
  /** Create (or re-derive) a proposal for an incident; optional explicit transform from an operator. */
  async createProposal(incidentId: string, input: { actor: string; transform?: AdapterSpec | undefined; proposedSolution?: string | undefined }) {
    const inc = await this.deps.store.getIncident(incidentId);
    if (!inc) throw new NotFoundError('Incident not found');
    const monitor = await this.mustMonitor(inc.monitorId);
    if (isAvailability(inc)) throw new UnprocessableError('Availability incidents (HTTP errors, timeouts) cannot be repaired with a response adapter');
    const baseline = inc.baselineId ? await this.deps.store.getBaseline(inc.baselineId) : null;
    const mappings = await this.deps.store.listMappings(monitor.id);
    let draft = buildProposal(monitor, inc, diffResponses(baseline?.snapshot ?? inc.previousResponse, inc.latestResponse, { renameThreshold: (await this.monitoringSettings()).renameThreshold, volatileFields: (await this.monitoringSettings()).volatileFields }), mappings, input.actor);
    if (input.transform) {
      const spec = adapterSpecSchema.parse(input.transform);
      draft = { ...draft, transform: spec, requiresManualReview: false, proposedSolution: input.proposedSolution ?? `Operator-defined adapter with ${spec.ops.length} operation(s).`, assumptions: [...draft.assumptions, 'Transformation defined manually by an operator.'] };
    }
    const rec = await this.deps.store.createProposal(draft);
    await this.audit('USER', input.actor, 'proposal.created', 'RECOVERY_PROPOSAL', rec.id, { target: inc.title, monitorId: monitor.id, incidentId, result: 'Success', summary: `Recovery proposal created with ${rec.transform.ops.length} operation(s)${rec.requiresManualReview ? ' (manual review required)' : ''}.` });
    this.deps.events.emit('proposal.created', { proposalId: rec.id, incidentId, monitorId: monitor.id });
    return this.proposalWire(rec);
  }

  /** Run the staging contract test: apply the adapter to the drifted response and assert the downstream contract. */
  async validateProposal(id: string, actor: string) {
    const p = await this.mustProposal(id);
    const inc = await this.deps.store.getIncident(p.incidentId);
    const monitor = await this.mustMonitor(p.monitorId);
    if (!inc) throw new NotFoundError('Incident not found');
    const baseline = (inc.baselineId ? await this.deps.store.getBaseline(inc.baselineId) : null) ?? (await this.deps.store.approvedBaseline(monitor.id));
    const latestCheck = inc.checkId ? await this.deps.store.getCheck(inc.checkId) : await this.deps.store.latestCheck(monitor.id);
    const mappings = await this.deps.store.listMappings(monitor.id);
    const settings = await this.monitoringSettings();
    const started = performance.now();
    const logs: string[] = [];
    const assertions: ValidationAssertion[] = [];
    const drifted = inc.latestResponse;
    logs.push(`[INIT] Isolated sandbox for ${monitor.name} (${p.targetEnvironment}); nothing here touches the live adapter.`);
    logs.push(`[INPUT] Drifted payload from incident ${inc.id.slice(0, 8)} (${inc.diffs.filter((d) => d.changeType !== 'value_changed').length} structural change(s)).`);
    logs.push(`[ADAPTER] Applying ${p.transform.ops.length} declarative operation(s)…`);
    const run1 = applyAdapter(p.transform, drifted);
    const run2 = applyAdapter(p.transform, drifted);
    assertions.push({ rule: 'Adapter applies without rejecting the drifted payload', passed: run1.ok, expected: 'no errors', actual: run1.ok ? 'ok' : run1.errors.join('; '), mandatory: true });
    assertions.push({ rule: 'Adapter output is deterministic (two runs identical)', passed: JSON.stringify(run1.output) === JSON.stringify(run2.output), expected: 'identical output hashes', actual: JSON.stringify(run1.output) === JSON.stringify(run2.output) ? 'identical' : 'different', mandatory: true });
    for (const t of run1.trace) logs.push(`[ADAPTER] ${t.op.op} ${'from' in t.op ? `${t.op.from} -> ${t.op.to}` : t.op.path}: ${t.detail}`);
    if (baseline) {
      const after = diffResponses(baseline.snapshot, run1.output, { renameThreshold: settings.renameThreshold, volatileFields: settings.volatileFields });
      const lost = after.changes.filter((c) => c.changeType === 'removed' || c.changeType === 'type_mismatch' || c.changeType === 'renamed');
      assertions.push({ rule: 'Every baseline field is present with its baseline type after adaptation', passed: lost.length === 0, expected: `${baseline.fieldPaths.length} baseline fields intact`, actual: lost.length === 0 ? 'all intact' : lost.map((c) => `${c.changeType} ${c.path}`).join(', '), mandatory: true });
      logs.push(`[ASSERT] Baseline contract after adapter: ${lost.length === 0 ? 'PASS' : `FAIL (${lost.length} field(s) still missing)`}`);
      const legacy = applyAdapter(p.transform, baseline.snapshot);
      const legacyDiff = diffResponses(baseline.snapshot, legacy.output, { renameThreshold: settings.renameThreshold, volatileFields: settings.volatileFields });
      assertions.push({ rule: 'Legacy (baseline-shaped) payload still passes through unchanged', passed: legacy.ok && !legacyDiff.breaking, expected: 'no breaking change on the baseline payload', actual: legacy.ok && !legacyDiff.breaking ? 'unchanged' : legacy.errors.join('; ') || legacyDiff.changes.map((c) => `${c.changeType} ${c.path}`).join(', '), mandatory: true });
      logs.push(`[ASSERT] Legacy payload compatibility: ${legacy.ok && !legacyDiff.breaking ? 'PASS' : 'FAIL'}`);
    } else {
      assertions.push({ rule: 'An approved baseline exists for the comparison', passed: false, expected: 'approved baseline', actual: 'none', mandatory: true });
    }
    for (const m of mappings) {
      const values = (() => {
        try {
          return resolveJsonPath(run1.output, m.jsonPath);
        } catch {
          return [];
        }
      })();
      const baselineValues = baseline ? resolveJsonPath(baseline.snapshot, m.jsonPath) : [];
      const expectedType = baselineValues.length ? jsonTypeOf(baselineValues[0]) : 'present';
      const ok = values.length > 0 && values.every((v) => v !== null && v !== undefined && (expectedType === 'present' || jsonTypeOf(v) === expectedType));
      assertions.push({ rule: `Feature "${m.feature}" can read ${m.jsonPath}`, passed: ok, expected: `${expectedType} value present`, actual: values.length === 0 ? 'missing' : values.length === 1 ? `${jsonTypeOf(values[0])} ${JSON.stringify(values[0])}`.slice(0, 80) : `${values.length} values`, mandatory: true });
      logs.push(`[ASSERT] ${m.feature} expects ${m.jsonPath}… ${ok ? 'PASS' : 'FAIL'}`);
    }
    if (latestCheck) {
      const statusOk = latestCheck.statusCode !== null && (baseline?.statusCode ? latestCheck.statusCode === baseline.statusCode : latestCheck.statusCode < 400);
      assertions.push({ rule: `HTTP status matches baseline (${baseline?.statusCode ?? '2xx'})`, passed: statusOk, expected: String(baseline?.statusCode ?? '2xx'), actual: String(latestCheck.statusCode ?? 'none'), mandatory: false });
      assertions.push({ rule: `Latency within monitor timeout (<${monitor.timeoutMs}ms)`, passed: latestCheck.latencyMs < monitor.timeoutMs, expected: `<${monitor.timeoutMs}ms`, actual: `${latestCheck.latencyMs}ms`, mandatory: false });
    }
    if (p.requiresManualReview) {
      assertions.push({ rule: 'Proposal does not require manual review', passed: false, expected: 'fully automatic mapping', actual: 'manual review flagged by the engine', mandatory: true });
      logs.push('[ASSERT] Manual review flag present… FAIL');
    }
    const failed = assertions.filter((a) => !a.passed);
    const mandatoryFailed = failed.filter((a) => a.mandatory);
    const status: ValidationResult['status'] = mandatoryFailed.length === 0 ? 'Passed' : 'Failed';
    logs.push(`[RESULT] ${status === 'Passed' ? 'Contract validation passed' : 'Contract validation FAILED'} ${assertions.length - failed.length}/${assertions.length} assertions${failed.length && !mandatoryFailed.length ? ' (non-mandatory failures only)' : ''}.`);
    const result: ValidationResult = {
      runId: `VAL-${randomUUID().slice(0, 8).toUpperCase()}`,
      testName: `${monitor.name} downstream contract test`,
      targetWorkflow: mappings.length ? mappings.map((m) => `${m.feature}${m.route ? ` (${m.route})` : ''}`).join(', ') : 'baseline contract (no feature mappings registered)',
      expectedResult: `Adapted payload satisfies ${baseline ? `${baseline.fieldPaths.length} baseline fields` : 'the baseline'} and ${mappings.length} feature mapping(s)`,
      actualResult: status === 'Passed' ? `All mandatory assertions passed (${assertions.length - failed.length}/${assertions.length}).` : `${mandatoryFailed.length} mandatory assertion(s) failed: ${mandatoryFailed.map((a) => a.rule).join('; ')}`,
      status,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      testTime: this.now().toISOString(),
      assertions,
      logs,
      adaptedSample: run1.output,
      executedBy: actor,
      ...(mandatoryFailed.length ? { errorDetails: mandatoryFailed.map((a) => `${a.rule}: ${a.actual}`).join('\n') } : {}),
    };
    const next = await this.deps.store.updateProposal(id, { validation: result });
    await this.audit('USER', actor, 'proposal.validated', 'RECOVERY_PROPOSAL', id, { target: `${monitor.name} (proposal ${id.slice(0, 8)})`, monitorId: monitor.id, result: status === 'Passed' ? 'Success' : 'Failure', summary: `Executed ${p.targetEnvironment.toLowerCase()} contract test ${result.runId}; ${assertions.length - failed.length}/${assertions.length} assertions passed.`, testId: result.runId, env: p.targetEnvironment, duration: `${result.latencyMs}ms` });
    this.deps.events.emit('proposal.updated', { proposalId: id, monitorId: monitor.id, validation: status });
    return this.proposalWire(next);
  }

  async approveProposal(id: string, actor: string, note?: string) {
    const p = await this.mustProposal(id);
    if (p.status !== 'PENDING') throw new ConflictError(`Proposal is ${p.status}; only PENDING proposals can be approved`);
    if (p.requiresManualReview && p.transform.ops.length === 0) throw new UnprocessableError('This proposal has no transformation to approve; define one first');
    const next = await this.deps.store.updateProposal(id, { status: 'APPROVED', approver: actor, approvedAt: this.now() });
    await this.audit('USER', actor, 'proposal.approved', 'RECOVERY_PROPOSAL', id, { target: id, monitorId: p.monitorId, result: 'Success', summary: `Sign-off granted by ${actor} for ${p.targetEnvironment.toLowerCase()} deployment${note ? `: ${note}` : ''}.` });
    this.deps.events.emit('proposal.updated', { proposalId: id, monitorId: p.monitorId, status: 'APPROVED' });
    return this.proposalWire(next);
  }
  async rejectProposal(id: string, actor: string, note?: string) {
    const p = await this.mustProposal(id);
    if (p.status === 'PROMOTED') throw new ConflictError('Roll the adapter back before rejecting a promoted proposal');
    const next = await this.deps.store.updateProposal(id, { status: 'REJECTED', rejectedBy: actor, rejectedAt: this.now() });
    await this.audit('USER', actor, 'proposal.rejected', 'RECOVERY_PROPOSAL', id, { target: id, monitorId: p.monitorId, result: 'Success', summary: `Rejected adapter proposal${note ? `: ${note}` : ''}.` });
    this.deps.events.emit('proposal.updated', { proposalId: id, monitorId: p.monitorId, status: 'REJECTED' });
    return this.proposalWire(next);
  }
  /** Promote: make the adapter active for the monitor. Requires approval and a passed validation. */
  async promoteProposal(id: string, actor: string) {
    const p = await this.mustProposal(id);
    if (p.status !== 'APPROVED') throw new ConflictError(`Proposal is ${p.status}; it must be APPROVED before promotion`);
    if (!p.validation || p.validation.status !== 'Passed') throw new ConflictError('Run the validation test and get a Passed result before promoting', { validation: p.validation?.status ?? 'none' });
    if (p.approver === actor && p.createdBy !== 'system' && p.createdBy === actor) throw new UnprocessableError('The same person cannot create, approve and promote a proposal');
    const monitor = await this.mustMonitor(p.monitorId);
    if (monitor.activeProposalId && monitor.activeProposalId !== id) {
      await this.deps.store.updateProposal(monitor.activeProposalId, { status: 'ROLLED_BACK' });
    }
    const next = await this.deps.store.updateProposal(id, { status: 'PROMOTED', promotedBy: actor, promotedAt: this.now() });
    await this.deps.store.updateMonitor(monitor.id, { activeProposalId: id });
    await this.audit('USER', actor, 'proposal.promoted', 'RECOVERY_PROPOSAL', id, { target: monitor.name, monitorId: monitor.id, result: 'Success', summary: `Adapter promoted to the gateway ruleset; responses of ${monitor.name} are now normalised before reaching consumers.`, validationRun: p.validation.runId, previousAdapter: monitor.activeProposalId });
    this.deps.events.emit('proposal.updated', { proposalId: id, monitorId: monitor.id, status: 'PROMOTED' });
    // Re-check immediately so the incident resolves through the adapter.
    await this.deps.engine.runCheck(monitor.id, actor).catch((err: unknown) => this.deps.logger.warn({ err }, 'post-promotion check failed'));
    return this.proposalWire(next);
  }
  async rollbackAdapter(monitorId: string, actor: string, reason: string) {
    const monitor = await this.mustMonitor(monitorId);
    if (!monitor.activeProposalId) throw new ConflictError('No adapter is active for this monitor');
    const prev = monitor.activeProposalId;
    await this.deps.store.updateProposal(prev, { status: 'ROLLED_BACK' });
    await this.deps.store.updateMonitor(monitorId, { activeProposalId: null });
    await this.audit('USER', actor, 'proposal.rolled_back', 'RECOVERY_PROPOSAL', prev, { target: monitor.name, monitorId, result: 'Success', summary: `Adapter rolled back: ${reason}.` });
    this.deps.events.emit('proposal.updated', { proposalId: prev, monitorId, status: 'ROLLED_BACK' });
    await this.deps.engine.runCheck(monitorId, actor).catch(() => undefined);
    return this.monitorWire((await this.deps.store.getMonitor(monitorId))!);
  }

  // --- audit & stats -------------------------------------------------------

  async listAudit(limit: number, entityType?: string, q?: string) {
    const rows = await this.deps.store.listAudit(limit, entityType);
    const wires = rows.map((a) => this.auditWire(a));
    return q ? wires.filter((w) => `${w.action} ${w.target} ${w.actor} ${w.details}`.toLowerCase().includes(q.toLowerCase())) : wires;
  }

  async overview() {
    const now = this.now();
    const monitors = await this.listMonitors();
    const incidents = await this.deps.store.listIncidents({ limit: 500 });
    const proposals = await this.deps.store.listProposals({ limit: 500 });
    const since7d = new Date(now.getTime() - 7 * 86_400_000);
    const since24h = new Date(now.getTime() - 86_400_000);
    const checks = await this.deps.store.listChecksSince(since7d, 5_000);
    const open = incidents.filter((i) => i.status !== 'RESOLVED');
    const healthy = monitors.filter((m) => m.health === 'Healthy');
    const changes = checks.filter((c) => c.diff && !c.diff.identical);
    const newThisWeek = monitors.filter((m) => new Date(m.createdAt) >= since7d).length;
    const openedToday = open.filter((i) => i.detectedAt >= since24h).length;
    const pct = monitors.length ? Math.round((healthy.length / monitors.length) * 1000) / 10 : 0;
    const cards = [
      { id: 'registered_apis', title: 'Registered APIs', value: String(monitors.length), change: newThisWeek ? `+${newThisWeek} this week` : 'no new this week', changeType: newThisWeek ? 'positive' : 'neutral', comparisonText: 'Monitored dependencies', visible: true },
      { id: 'healthy_apis', title: 'Healthy APIs', value: String(healthy.length), change: `${pct}%`, changeType: pct >= 80 ? 'positive' : pct >= 50 ? 'neutral' : 'negative', comparisonText: 'Passing live checks', visible: true },
      { id: 'open_incidents', title: 'Open Incidents', value: String(open.length), change: openedToday ? `+${openedToday} today` : 'none today', changeType: open.length ? 'negative' : 'positive', comparisonText: 'Active schema/latency drift', visible: true },
      { id: 'changes_detected', title: 'Changes Detected', value: String(changes.length), change: 'Last 7 days', changeType: 'neutral', comparisonText: 'Response payload drift events', visible: true },
    ];
    const traffic: Array<{ date: string; label: string; volume: number }> = [];
    for (let d = 6; d >= 0; d--) {
      const day = new Date(now.getTime() - d * 86_400_000);
      const key = day.toISOString().slice(0, 10);
      traffic.push({ date: key, label: day.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }), volume: checks.filter((c) => c.checkedAt.toISOString().slice(0, 10) === key).length });
    }
    const buckets = 6;
    const responseTimes: Array<{ time: string; avgLatency: number; peakLatency: number; samples: number }> = [];
    for (let b = buckets - 1; b >= 0; b--) {
      const end = new Date(now.getTime() - b * (86_400_000 / buckets));
      const start = new Date(end.getTime() - 86_400_000 / buckets);
      const inBucket = checks.filter((c) => c.checkedAt >= start && c.checkedAt < end && c.outcome === 'SUCCESS');
      const avg = inBucket.length ? Math.round(inBucket.reduce((s, c) => s + c.latencyMs, 0) / inBucket.length) : 0;
      const peak = inBucket.length ? Math.max(...inBucket.map((c) => c.latencyMs)) : 0;
      responseTimes.push({ time: `${String(start.getHours()).padStart(2, '0')}:00`, avgLatency: avg, peakLatency: peak, samples: inBucket.length });
    }
    return { generatedAt: now.toISOString(), cards, traffic, responseTimes, counts: { monitors: monitors.length, healthy: healthy.length, openIncidents: open.length, pendingProposals: proposals.filter((p) => p.status === 'PENDING').length, checks7d: checks.length, changes7d: changes.length } };
  }

  // --- wire shapes -----------------------------------------------------------

  private async mustMonitor(id: string): Promise<MonitorRecord> {
    const m = await this.deps.store.getMonitor(id);
    if (!m) throw new NotFoundError('Monitor not found');
    return m;
  }
  private async mustProposal(id: string): Promise<ProposalRecord> {
    const p = await this.deps.store.getProposal(id);
    if (!p) throw new NotFoundError('Proposal not found');
    return p;
  }
  private audit(actorType: 'SYSTEM' | 'USER', actorId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
    return this.deps.store.appendAudit({ actorType, actorId, action, entityType, entityId, details });
  }

  async monitorWire(m: MonitorRecord) {
    const [checks, baselines, incidents] = await Promise.all([this.deps.store.listChecks(m.id, 100), this.deps.store.listBaselines(m.id), this.deps.store.listIncidents({ monitorId: m.id, limit: 50 })]);
    const approved = baselines.find((b) => b.status === 'APPROVED') ?? null;
    const pending = baselines.find((b) => b.status === 'PENDING') ?? null;
    const open = incidents.filter((i) => i.status !== 'RESOLVED');
    const successes = checks.filter((c) => c.outcome === 'SUCCESS').length;
    let health: 'Healthy' | 'Failing' | 'Review Needed' | 'Paused' | 'Unknown';
    if (m.status === 'PAUSED') health = 'Paused';
    else if (!m.lastOutcome) health = 'Unknown';
    else if (m.lastOutcome !== 'SUCCESS' || open.some(isAvailability)) health = 'Failing';
    else if (open.length > 0 || pending) health = 'Review Needed';
    else health = 'Healthy';
    const latest = checks[0] ?? null;
    return {
      id: m.id,
      name: m.name,
      url: m.url,
      method: m.method,
      environment: m.environment,
      description: m.description,
      intervalSec: m.intervalSec,
      interval: secondsToInterval(m.intervalSec),
      timeoutMs: m.timeoutMs,
      authType: AUTH_LABEL[m.authType],
      authTypeCode: m.authType,
      authHeader: m.authHeader,
      hasSecret: Boolean(m.authSecretEnc),
      headers: m.headers,
      body: m.body,
      expectedStatus: m.expectedStatus,
      autoBaseline: m.autoBaseline,
      status: m.status,
      health,
      lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null,
      nextRunAt: m.nextRunAt?.toISOString() ?? null,
      lastOutcome: m.lastOutcome,
      lastStatusCode: m.lastStatusCode,
      lastLatencyMs: m.lastLatencyMs,
      lastError: latest?.errorMessage ?? null,
      lastParseOutcome: latest?.parseOutcome ?? null,
      /** Successful but not JSON: only status and latency can be monitored. */
      statusOnly: latest !== null && latest.outcome === 'SUCCESS' && latest.parseOutcome !== 'JSON',
      uptimePct: checks.length ? Math.round((successes / checks.length) * 1000) / 10 : null,
      checksCount: checks.length,
      baseline: approved ? this.baselineWire(approved) : null,
      pendingBaseline: pending ? this.baselineWire(pending) : null,
      baselineApproved: approved !== null,
      openIncidentCount: open.length,
      openIncidentId: open[0]?.id ?? null,
      hasIncident: open.length > 0,
      activeProposalId: m.activeProposalId,
      history: checks.slice(0, 30).reverse().map((c) => ({ time: c.checkedAt.toISOString(), latency: c.latencyMs, status: c.statusCode, outcome: c.outcome, changed: Boolean(c.diff && !c.diff.identical) })),
      createdBy: m.createdBy,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
  checkWire(c: CheckRecord) {
    return { ...c, checkedAt: c.checkedAt.toISOString() };
  }
  baselineWire(b: BaselineRecord, full = false) {
    return { id: b.id, monitorId: b.monitorId, version: b.version, status: b.status, statusCode: b.statusCode, latencyMs: b.latencyMs, fieldCount: b.fieldPaths.length, shapeHash: b.shapeHash, approvedBy: b.approvedBy, approvedAt: b.approvedAt?.toISOString() ?? null, note: b.note, createdAt: b.createdAt.toISOString(), checkId: b.checkId, ...(full ? { snapshot: b.snapshot, fieldPaths: b.fieldPaths } : {}) };
  }
  mappingWire(m: MappingRecord, apiName: string) {
    return { id: m.id, monitorId: m.monitorId, feature: m.feature, api: apiName, jsonPath: m.jsonPath, route: m.route, impactLevel: m.impactLevel, description: m.description, symptom: m.symptom, createdBy: m.createdBy, createdAt: m.createdAt.toISOString() };
  }
  async incidentWire(i: IncidentRecord) {
    const monitor = await this.deps.store.getMonitor(i.monitorId);
    const mappings = await this.deps.store.listMappings(i.monitorId);
    const proposals = await this.deps.store.listProposals({ incidentId: i.id, limit: 20 });
    const structural = i.diffs.filter((d) => d.changeType !== 'value_changed');
    const affected = isAvailability(i)
      ? mappings.map((m) => ({ ...m, change: { changeType: 'removed' as const, path: '$', expected: 'response', actual: i.issueType } }))
      : affectedMappings(mappings, structural);
    const latest = i.latestResponse;
    const affectedFeatures = affected.map((m) => ({
      mappingId: m.id,
      featureName: m.feature,
      apiName: monitor?.name ?? i.monitorId,
      expectedField: m.jsonPath.replace(/^\$\.?/, ''),
      jsonPath: m.jsonPath,
      impactLevel: m.impactLevel,
      route: m.route ?? '',
      description: m.description ?? `Reads ${m.jsonPath} from ${monitor?.name ?? 'the API'}.`,
      userFacingSymptom: m.symptom ?? (m.change.changeType === 'renamed' ? `Field now arrives as ${m.change.newPath}; consumers reading ${m.jsonPath} get undefined.` : m.change.changeType === 'type_mismatch' ? `Value type changed; parsing or rendering may fail.` : `Expected field is missing from the response.`),
      stillPresent: latest !== null && latest !== undefined && !isAvailability(i) ? jsonPathExists(latest, m.jsonPath) : false,
      reason: m.change.changeType === 'renamed' ? `${m.change.path} renamed to ${m.change.newPath}` : `${m.change.changeType.replace('_', ' ')}: ${m.change.path}`,
    }));
    return {
      id: i.id,
      monitorId: i.monitorId,
      apiId: i.monitorId,
      apiName: monitor?.name ?? i.monitorId,
      environment: monitor?.environment ?? null,
      endpoint: monitor?.url ?? null,
      title: i.title,
      issueType: i.issueType,
      severity: i.severity,
      status: INCIDENT_STATUS_LABEL[i.status],
      statusCode: i.status,
      detectedAt: i.detectedAt.toISOString(),
      lastSeenAt: i.lastSeenAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      occurrenceCount: i.occurrenceCount,
      httpStatus: i.statusCode,
      latencyMs: i.latencyMs,
      previousResponse: i.previousResponse,
      latestResponse: i.latestResponse,
      diffs: i.diffs.map((d) => ({ fieldName: d.changeType === 'renamed' && d.newPath ? `${d.path} → ${d.newPath}` : d.path, changeType: d.changeType, expected: d.expected, actual: d.actual, path: d.path, newPath: d.newPath ?? null, evidence: d.evidence ?? null })),
      affectedFeatures,
      registeredMappings: mappings.map((m) => ({ id: m.id, feature: m.feature, api: monitor?.name ?? i.monitorId, jsonPath: m.jsonPath, route: m.route, impactLevel: m.impactLevel })),
      proposalId: proposals[0]?.id ?? null,
      proposalIds: proposals.map((p) => p.id),
      assignee: i.assignee,
      note: i.note,
      statusChangedBy: i.statusChangedBy,
      baselineId: i.baselineId,
      checkId: i.checkId,
    };
  }
  async proposalWire(p: ProposalRecord) {
    const [inc, monitor] = await Promise.all([this.deps.store.getIncident(p.incidentId), this.deps.store.getMonitor(p.monitorId)]);
    return {
      id: p.id,
      incidentId: p.incidentId,
      incidentTitle: inc?.title ?? '',
      monitorId: p.monitorId,
      apiName: monitor?.name ?? p.monitorId,
      status: PROPOSAL_STATUS_LABEL[p.status],
      statusCode: p.status,
      proposedSolution: p.proposedSolution,
      adapterTransformation: describeAdapter(p.transform),
      transform: p.transform,
      assumptions: p.assumptions,
      risks: p.risks,
      requiresManualReview: p.requiresManualReview,
      targetEnvironment: p.targetEnvironment,
      createdBy: p.createdBy,
      createdAt: p.createdAt.toISOString(),
      approver: p.approver,
      approvedAt: p.approvedAt?.toISOString() ?? null,
      rejectedBy: p.rejectedBy,
      promotedBy: p.promotedBy,
      promotedAt: p.promotedAt?.toISOString() ?? null,
      isActive: monitor?.activeProposalId === p.id,
      validationResult: p.validation,
    };
  }
  auditWire(a: AuditRecord) {
    const d = a.details;
    const { target: _t, summary: _s, result: _r, ...metadata } = d;
    return {
      id: a.id,
      timestamp: a.createdAt.toISOString(),
      actor: a.actorType === 'SYSTEM' ? (a.actorId === 'ssrf-guard' ? 'System (Security Guard)' : a.actorId === 'scheduler' ? 'System (Automated Monitor)' : 'System (Guardian Engine)') : a.actorId,
      actorType: a.actorType === 'SYSTEM' ? (a.actorId === 'ssrf-guard' ? 'Security' : 'System') : 'Developer',
      action: ACTION_LABEL[a.action] ?? a.action,
      actionCode: a.action,
      target: typeof d['target'] === 'string' ? d['target'] : a.entityId,
      result: d['result'] === 'Failure' ? 'Failure' : 'Success',
      details: typeof d['summary'] === 'string' ? d['summary'] : '',
      metadata: { entityType: a.entityType, entityId: a.entityId, ...metadata },
    };
  }
}

function flattenCount(v: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  const visit = (x: unknown, path: string): void => {
    if (path) out[path] = true;
    if (Array.isArray(x)) for (const i of x) visit(i, `${path}[]`);
    else if (x && typeof x === 'object') for (const [k, c] of Object.entries(x as Record<string, unknown>)) visit(c, path ? `${path}.${k}` : k);
  };
  visit(v, '');
  return out;
}
export type MonitorWire = Awaited<ReturnType<GuardianService['monitorWire']>>;
export type IncidentWire = Awaited<ReturnType<GuardianService['incidentWire']>>;
export type ProposalWire = Awaited<ReturnType<GuardianService['proposalWire']>>;
export function intervalSecondsFrom(s: string): number {
  return intervalToSeconds(s);
}
