/** Wire types of the DriftGuard backend Phase 9 API (`/api/monitors`, `/api/incidents`, ...). */

export type MonitorHealth = 'Healthy' | 'Failing' | 'Review Needed' | 'Paused' | 'Unknown';

export interface BaselineDto {
  id: string;
  monitorId: string;
  version: number;
  status: 'PENDING' | 'APPROVED' | 'SUPERSEDED' | 'REJECTED';
  statusCode: number | null;
  latencyMs: number | null;
  fieldCount: number;
  shapeHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
  createdAt: string;
  checkId: string | null;
  snapshot?: unknown;
  fieldPaths?: Array<{ path: string; type: string }>;
}

export interface MonitorDto {
  id: string;
  name: string;
  url: string;
  method: string;
  environment: string;
  description: string;
  intervalSec: number;
  interval: string;
  timeoutMs: number;
  authType: string;
  authTypeCode: 'NONE' | 'BEARER' | 'API_KEY' | 'BASIC';
  authHeader: string | null;
  hasSecret: boolean;
  headers: Record<string, string>;
  body: unknown;
  expectedStatus: number | null;
  autoBaseline: boolean;
  status: 'ACTIVE' | 'PAUSED';
  health: MonitorHealth;
  lastCheckedAt: string | null;
  nextRunAt: string | null;
  lastOutcome: string | null;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastParseOutcome: string | null;
  statusOnly: boolean;
  uptimePct: number | null;
  checksCount: number;
  baseline: BaselineDto | null;
  pendingBaseline: BaselineDto | null;
  baselineApproved: boolean;
  openIncidentCount: number;
  openIncidentId: string | null;
  hasIncident: boolean;
  activeProposalId: string | null;
  history: Array<{ time: string; latency: number; status: number | null; outcome: string; changed: boolean }>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldChangeDto {
  fieldName: string;
  changeType: 'removed' | 'added' | 'type_mismatch' | 'renamed' | 'value_changed';
  expected: string;
  actual: string;
  path: string;
  newPath: string | null;
  evidence: { nameSimilarity: number; valueMatch: boolean; typeCompatible: boolean; sameParent: boolean; singleSwap: boolean; score: number } | null;
}

export interface AffectedFeatureDto {
  mappingId: string;
  featureName: string;
  apiName: string;
  expectedField: string;
  jsonPath: string;
  impactLevel: string;
  route: string;
  description: string;
  userFacingSymptom: string;
  stillPresent: boolean;
  reason: string;
}

export interface MappingDto {
  id: string;
  monitorId: string;
  feature: string;
  api: string;
  jsonPath: string;
  route: string | null;
  impactLevel: string;
  description?: string | null;
  symptom?: string | null;
  createdBy?: string;
  createdAt?: string;
}

export interface IncidentDto {
  id: string;
  monitorId: string;
  apiId: string;
  apiName: string;
  environment: string | null;
  endpoint: string | null;
  title: string;
  issueType: string;
  severity: string;
  status: 'Open' | 'Investigating' | 'Awaiting Fix' | 'Resolved';
  statusCode: 'OPEN' | 'INVESTIGATING' | 'AWAITING_FIX' | 'RESOLVED';
  detectedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  occurrenceCount: number;
  httpStatus: number | null;
  latencyMs: number | null;
  previousResponse: unknown;
  latestResponse: unknown;
  diffs: FieldChangeDto[];
  affectedFeatures: AffectedFeatureDto[];
  registeredMappings: MappingDto[];
  proposalId: string | null;
  proposalIds: string[];
  assignee: string | null;
  note: string | null;
  statusChangedBy: string | null;
  baselineId: string | null;
  checkId: string | null;
}

export interface ValidationAssertionDto {
  rule: string;
  passed: boolean;
  expected: string;
  actual: string;
  mandatory: boolean;
}
export interface ValidationResultDto {
  runId: string;
  testName: string;
  targetWorkflow: string;
  expectedResult: string;
  actualResult: string;
  status: 'Passed' | 'Failed' | 'Inconclusive';
  latencyMs: number;
  testTime: string;
  assertions: ValidationAssertionDto[];
  logs: string[];
  adaptedSample: unknown;
  errorDetails?: string;
  executedBy: string;
}

export type AdapterOpDto =
  | { op: 'rename'; from: string; to: string; removeSource: boolean; onConflict: 'keep_target' | 'prefer_source' | 'reject' }
  | { op: 'coerce'; path: string; toType: 'string' | 'number' | 'boolean' }
  | { op: 'default'; path: string; value: string | number | boolean | null };

export interface ProposalDto {
  id: string;
  incidentId: string;
  incidentTitle: string;
  monitorId: string;
  apiName: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Promoted' | 'Rolled Back';
  statusCode: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROMOTED' | 'ROLLED_BACK';
  proposedSolution: string;
  adapterTransformation: string;
  transform: { version: 1; ops: AdapterOpDto[] };
  assumptions: string[];
  risks: string[];
  requiresManualReview: boolean;
  targetEnvironment: string;
  createdBy: string;
  createdAt: string;
  approver: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  promotedBy: string | null;
  promotedAt: string | null;
  isActive: boolean;
  validationResult: ValidationResultDto | null;
}

export interface AuditDto {
  id: string;
  timestamp: string;
  actor: string;
  actorType: 'Developer' | 'System' | 'Security';
  action: string;
  actionCode: string;
  target: string;
  result: 'Success' | 'Failure';
  details: string;
  metadata: Record<string, unknown>;
}

export interface OverviewDto {
  generatedAt: string;
  cards: Array<{ id: string; title: string; value: string; change: string; changeType: 'positive' | 'negative' | 'neutral'; comparisonText: string; visible: boolean }>;
  traffic: Array<{ date: string; label: string; volume: number }>;
  responseTimes: Array<{ time: string; avgLatency: number; peakLatency: number; samples: number }>;
  counts: { monitors: number; healthy: number; openIncidents: number; pendingProposals: number; checks7d: number; changes7d: number };
}

export interface MonitoringSettingsDto {
  defaultInterval: string;
  defaultTimeout: number;
  defaultEnvironment: string;
  alertSlack: boolean;
  alertEmail: boolean;
  alertPagerDuty: boolean;
  ssrfProtection: boolean;
  autoBaseline: boolean;
  renameThreshold: number;
  volatileFields: string[];
  incidentOnAdditive: boolean;
}
export interface ProfileDto {
  name: string;
  email: string;
  role: string;
  organization: string;
}
export interface SettingsDto {
  monitoring: MonitoringSettingsDto;
  profile: ProfileDto;
  runtime: { allowPrivateNetworks: boolean; schedulerEnabled: boolean; secretsConfigured: boolean; nodeEnv: string };
}

export interface TestConnectionDto {
  outcome: string;
  status: number | null;
  latencyMs: number;
  bytes: number;
  parseOutcome: string;
  contentType: string | null;
  preview: unknown;
  error: string | null;
  blocked: boolean;
  reason: string | null;
  safe: boolean;
  fieldCount: number;
}

export interface CheckDto {
  id: string;
  monitorId: string;
  checkedAt: string;
  outcome: string;
  statusCode: number | null;
  latencyMs: number;
  responseBytes: number;
  parseOutcome: string;
  bodySample: unknown;
  shapeHash: string | null;
  errorMessage: string | null;
  diff: { identical: boolean; breaking: boolean; changes: FieldChangeDto[]; counts: Record<string, number> } | null;
  adapted: boolean;
  incidentId: string | null;
  triggeredBy: string;
}

export interface CheckRunDto {
  monitor: MonitorDto;
  check: CheckDto;
  diff: CheckDto['diff'];
  incidentId: string | null;
  proposalId: string | null;
  baselineCreated: BaselineDto | null;
  resolvedIncidents: string[];
}

export interface WhoamiDto {
  role: 'operator' | 'reader';
  authRequired: boolean;
  tokenPresented: boolean;
}

export interface DemoEndpointDto {
  key: string;
  name: string;
  method: 'GET' | 'POST';
  path: string;
  url: string;
  mode: 'drifts' | 'healthy' | 'broken' | 'flaky';
  failureType: string;
  demonstrates: string;
  expectedDetection: string;
  mappings: Array<{ feature: string; jsonPath: string; route: string; impactLevel: string }>;
  autoRepairable: boolean;
  requestBody?: Record<string, unknown>;
  state: { calls: number; firstCalledAt: string | null; driftsAt: string | null; forced: 'drift' | 'restore' | null; drifted: boolean };
  monitorId: string | null;
  health: string | null;
}
export interface DemoCatalogDto {
  driftAfterMs: number;
  endpoints: DemoEndpointDto[];
}

export interface CreateMonitorInput {
  name: string;
  url: string;
  method: string;
  environment: string;
  description?: string;
  intervalSec: number;
  timeoutMs: number;
  authType: 'NONE' | 'BEARER' | 'API_KEY' | 'BASIC';
  authSecret?: string;
  authHeader?: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number;
  autoBaseline: boolean;
  createdBy: string;
}
