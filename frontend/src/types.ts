export type NavSection = 
  | 'Dashboard' 
  | 'Incidents' 
  | 'Recovery' 
  | 'Reports' 
  | 'Audit Log' 
  | 'Settings'
  | 'API Checks'
  | 'Monitoring'
  | 'Logs'
  | 'Alerts'
  | 'Help Center'
  | 'Feedback';

export type PublicViewMode = 'app' | 'landing' | 'login' | 'signup';

export interface MetricCardData {
  id: string;
  title: string;
  value: string;
  change: string;
  changeType: 'positive' | 'negative' | 'neutral';
  comparisonText: string;
  visible: boolean;
}

export interface TrafficDataPoint {
  date: string;
  label: string;
  volume: number;
}

export interface ResponseTimeDataPoint {
  time: string;
  avgLatency: number;
  peakLatency: number;
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl?: string;
  role: string;
  organization: string;
}

export type ApiHealthStatus = 'Healthy' | 'Failing' | 'Review Needed' | 'Paused' | 'Unknown';
export type EnvironmentType = 'Production' | 'Staging' | 'Development';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type AuthType = 'None' | 'Bearer Token' | 'API Key' | 'Basic Auth';

export interface RegisteredApi {
  id: string;
  name: string;
  url: string;
  method: HttpMethod;
  environment: EnvironmentType;
  status: ApiHealthStatus;
  responseTime: string;
  responseTimeNumeric: number;
  lastChecked: string;
  hasIncident: boolean;
  incidentId?: string;
  baselineApproved: boolean;
  interval: string;
  timeout: number;
  authType: AuthType;
  description: string;
  uptime: string;
  history: { time: string; latency: number; status: number }[];
  /** Backend extras */
  openIncidentCount?: number;
  pendingBaselineId?: string;
  activeProposalId?: string | null;
  lastOutcome?: string | null;
  lastError?: string | null;
  statusOnly?: boolean;
}

export interface AffectedFeatureMapping {
  featureName: string;
  apiName: string;
  expectedField: string;
  impactLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  route: string;
  affectedUsersPercentage: string;
  description: string;
  userFacingSymptom: string;
}

export interface IncidentFieldDiff {
  fieldName: string;
  changeType: 'removed' | 'renamed' | 'type_mismatch' | 'added';
  expected: string;
  actual: string;
}

export interface Incident {
  id: string;
  title: string;
  apiId?: string;
  apiName?: string;
  issueType?: 'Field removed' | 'Type changed' | 'HTTP error' | 'Timeout' | 'Schema drift';
  severity?: 'Critical' | 'High' | 'Medium' | 'Low';
  priority?: 'P1' | 'P2' | 'P3';
  status: 'Open' | 'Investigating' | 'Awaiting Fix' | 'Resolved' | 'Identified' | 'Monitoring';
  detectedAt?: string;
  created?: string;
  region?: string;
  service?: string;
  impact?: string;
  slackChannel?: string;
  environment?: EnvironmentType;
  endpoint?: string;
  previousResponse?: string;
  latestResponse?: string;
  diffs?: IncidentFieldDiff[];
  affectedFeatures?: AffectedFeatureMapping[];
  affectedComponents?: any[];
  timeline?: any[];
  remediations?: any[];
  registeredMappings?: { feature: string; api: string; jsonPath: string }[];
  proposalId?: string;
  occurrenceCount?: number;
  lastSeenAt?: string;
  assignee: {
    name: string;
    role: string;
  };
}

export interface ValidationAssertion {
  rule: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface ValidationResult {
  runId: string;
  testName: string;
  targetWorkflow: string;
  expectedResult: string;
  actualResult: string;
  status: 'Passed' | 'Failed' | 'Inconclusive';
  latencyMs: number;
  testTime: string;
  assertions: ValidationAssertion[];
  errorDetails?: string;
  logs?: string[];
}

export interface RecoveryProposal {
  id: string;
  incidentId: string;
  incidentTitle: string;
  apiName: string;
  proposedSolution: string;
  adapterTransformation: string;
  assumptions: string[];
  risks: string[];
  status: 'Pending' | 'Approved' | 'Rejected';
  /** Exact backend status label (Pending, Approved, Rejected, Promoted, Rolled Back). */
  statusLabel?: string;
  isActive?: boolean;
  requiresManualReview?: boolean;
  promotedBy?: string;
  createdBy?: string;
  approver?: string;
  createdAt: string;
  targetEnvironment: EnvironmentType;
  validationResult?: ValidationResult;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  actor: string;
  actorType: 'Developer' | 'System' | 'Security';
  action: string;
  target: string;
  result: 'Success' | 'Failure';
  details: string;
  metadata?: Record<string, any>;
}

export interface MonitoringSettings {
  defaultInterval: string;
  defaultTimeout: number;
  defaultEnvironment: EnvironmentType;
  alertSlack: boolean;
  alertEmail: boolean;
  alertPagerDuty: boolean;
  ssrfProtection: boolean;
  autoBaseline: boolean;
}

// Backward compatibility types for older widgets
export interface ServiceItem {
  id: string;
  status: 'Up' | 'Degraded' | 'Down';
  name: string;
  url: string;
  uptime: string;
  response: string;
  uptimeNumeric: number;
  responseNumeric: number;
  category: 'Web' | 'API' | 'Infrastructure' | 'Database' | 'Storage' | 'Communication';
  lastIncident?: string;
  sslExpiresIn?: string;
  statusMessage?: string;
}

export type ApiCheckStatus = 'Healthy' | 'Degraded' | 'Failing' | 'Paused';

export interface ApiCheckItem {
  id: string;
  name: string;
  url: string;
  method: HttpMethod;
  status: ApiCheckStatus;
  timeline: ('success' | 'warning' | 'error' | 'empty')[];
  successRate: string;
  successRateNumeric: number | null;
  avgLatency: string;
  avgLatencyNumeric: number | null;
  assertionsPassed: number;
  assertionsTotal: number;
  lastCheck: string;
  headers?: Record<string, string>;
  bodySnippet?: string;
  assertionsList?: { rule: string; passed: boolean }[];
  expectedStatus?: number;
  interval?: string;
}

export interface AffectedComponent {
  id: string;
  name: string;
  type: 'Page' | 'Component' | 'API Flow' | 'Microservice';
  route?: string;
  impactLevel: 'Critical' | 'Degraded' | 'Broken' | 'Operational';
  affectedUsersPercentage: string;
  description: string;
  userFacingSymptom: string;
  statusBadge: string;
}
