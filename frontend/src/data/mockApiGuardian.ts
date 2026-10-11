import { 
  RegisteredApi, 
  Incident, 
  RecoveryProposal, 
  AuditLogItem, 
  MonitoringSettings, 
  MetricCardData, 
  TrafficDataPoint, 
  ResponseTimeDataPoint,
  UserProfile 
} from '../types';

export const initialUserProfile: UserProfile = {
  name: 'Alex Rivera',
  email: 'alex.rivera@apiguardian.dev',
  role: 'Staff Reliability Engineer',
  organization: 'Apex Cloud Systems'
};

export const initialMetricCards: MetricCardData[] = [
  {
    id: 'registered_apis',
    title: 'Registered APIs',
    value: '6',
    change: '+1 this week',
    changeType: 'positive',
    comparisonText: 'Monitored dependencies',
    visible: true,
  },
  {
    id: 'healthy_apis',
    title: 'Healthy APIs',
    value: '4',
    change: '66.7%',
    changeType: 'positive',
    comparisonText: 'Passing live checks',
    visible: true,
  },
  {
    id: 'open_incidents',
    title: 'Open Incidents',
    value: '2',
    change: '+1 today',
    changeType: 'negative',
    comparisonText: 'Active schema/latency drift',
    visible: true,
  },
  {
    id: 'changes_detected',
    title: 'Changes Detected',
    value: '5',
    change: 'Last 7 days',
    changeType: 'neutral',
    comparisonText: 'Response payload drift events',
    visible: true,
  },
];

export const initialTrafficData: TrafficDataPoint[] = [
  { date: '2026-10-05', label: 'Oct 05', volume: 8400 },
  { date: '2026-10-06', label: 'Oct 06', volume: 9150 },
  { date: '2026-10-07', label: 'Oct 07', volume: 8900 },
  { date: '2026-10-08', label: 'Oct 08', volume: 10450 },
  { date: '2026-10-09', label: 'Oct 09', volume: 11200 },
  { date: '2026-10-10', label: 'Oct 10', volume: 12100 },
  { date: '2026-10-11', label: 'Oct 11', volume: 13540 },
];

export const initialResponseTimes: ResponseTimeDataPoint[] = [
  { time: '00:00', avgLatency: 112, peakLatency: 138 },
  { time: '04:00', avgLatency: 125, peakLatency: 149 },
  { time: '08:00', avgLatency: 148, peakLatency: 172 },
  { time: '12:00', avgLatency: 164, peakLatency: 195 },
  { time: '16:00', avgLatency: 178, peakLatency: 220 },
  { time: '20:00', avgLatency: 139, peakLatency: 165 },
  { time: '23:59', avgLatency: 128, peakLatency: 154 },
];

export const initialRegisteredApis: RegisteredApi[] = [
  {
    id: 'api-1',
    name: 'User Profile API',
    url: 'https://api.external-users.io/v2/profile/104',
    method: 'GET',
    environment: 'Production',
    status: 'Review Needed',
    responseTime: '142ms',
    responseTimeNumeric: 142,
    lastChecked: '2m ago',
    hasIncident: true,
    incidentId: 'INC-001',
    baselineApproved: true,
    interval: '5m',
    timeout: 5000,
    authType: 'Bearer Token',
    description: 'Third-party user identity service returning account details and user metadata.',
    uptime: '99.4%',
    history: [
      { time: '12:00', latency: 138, status: 200 },
      { time: '12:05', latency: 145, status: 200 },
      { time: '12:10', latency: 142, status: 200 },
      { time: '12:15', latency: 140, status: 200 },
    ]
  },
  {
    id: 'api-2',
    name: 'Payments Gateway API',
    url: 'https://pay.gateway.net/v1/transactions/tx_8912',
    method: 'GET',
    environment: 'Production',
    status: 'Failing',
    responseTime: '890ms',
    responseTimeNumeric: 890,
    lastChecked: '1m ago',
    hasIncident: true,
    incidentId: 'INC-002',
    baselineApproved: true,
    interval: '1m',
    timeout: 3000,
    authType: 'API Key',
    description: 'Card & digital wallet settlement webhook and transaction lookup endpoint.',
    uptime: '97.2%',
    history: [
      { time: '12:00', latency: 210, status: 200 },
      { time: '12:05', latency: 450, status: 200 },
      { time: '12:10', latency: 890, status: 504 },
    ]
  },
  {
    id: 'api-3',
    name: 'Orders & Fulfillment API',
    url: 'https://orders.internal.mesh/api/v3/orders/recent',
    method: 'GET',
    environment: 'Production',
    status: 'Healthy',
    responseTime: '64ms',
    responseTimeNumeric: 64,
    lastChecked: '4m ago',
    hasIncident: false,
    baselineApproved: true,
    interval: '5m',
    timeout: 4000,
    authType: 'Bearer Token',
    description: 'Core inventory reservation and order tracking backend service.',
    uptime: '99.98%',
    history: [
      { time: '12:00', latency: 62, status: 200 },
      { time: '12:05', latency: 65, status: 200 },
      { time: '12:10', latency: 64, status: 200 },
    ]
  },
  {
    id: 'api-4',
    name: 'Catalog Inventory API',
    url: 'https://catalog.warehouse.corp/sku/inventory',
    method: 'GET',
    environment: 'Staging',
    status: 'Healthy',
    responseTime: '45ms',
    responseTimeNumeric: 45,
    lastChecked: '7m ago',
    hasIncident: false,
    baselineApproved: true,
    interval: '15m',
    timeout: 5000,
    authType: 'None',
    description: 'Product catalog availability cache and stock calculation endpoint.',
    uptime: '100%',
    history: [
      { time: '12:00', latency: 48, status: 200 },
      { time: '12:05', latency: 45, status: 200 },
    ]
  },
  {
    id: 'api-5',
    name: 'Authentication SSO Service',
    url: 'https://auth.enterprise.org/.well-known/jwks.json',
    method: 'GET',
    environment: 'Production',
    status: 'Healthy',
    responseTime: '88ms',
    responseTimeNumeric: 88,
    lastChecked: '3m ago',
    hasIncident: false,
    baselineApproved: true,
    interval: '5m',
    timeout: 5000,
    authType: 'None',
    description: 'Public cryptographic keys for JWT token signature verification.',
    uptime: '99.99%',
    history: [
      { time: '12:00', latency: 91, status: 200 },
      { time: '12:05', latency: 88, status: 200 },
    ]
  },
  {
    id: 'api-6',
    name: 'Customer Notification Webhook',
    url: 'https://notify.messaging.io/v1/dispatch/status',
    method: 'GET',
    environment: 'Development',
    status: 'Paused',
    responseTime: '115ms',
    responseTimeNumeric: 115,
    lastChecked: '25m ago',
    hasIncident: false,
    baselineApproved: false,
    interval: '30m',
    timeout: 5000,
    authType: 'API Key',
    description: 'Transactional SMS and Email dispatching health check.',
    uptime: '98.5%',
    history: []
  }
];

export const initialIncidents: Incident[] = [
  {
    id: 'INC-001',
    title: 'User API field renamed (name -> display_name)',
    apiId: 'api-1',
    apiName: 'User Profile API',
    issueType: 'Field removed',
    severity: 'High',
    status: 'Open',
    detectedAt: '11 Oct 2026, 11:42 UTC',
    environment: 'Production',
    endpoint: 'https://api.external-users.io/v2/profile/104',
    previousResponse: JSON.stringify({
      id: 104,
      name: "Aman Gupta",
      email: "aman@example.com",
      role: "admin",
      status: "active"
    }, null, 2),
    latestResponse: JSON.stringify({
      id: 104,
      display_name: "Aman Gupta",
      email: "aman@example.com",
      role: "admin",
      status: "active"
    }, null, 2),
    diffs: [
      {
        fieldName: 'name',
        changeType: 'removed',
        expected: 'name: "Aman Gupta"',
        actual: 'Missing in response'
      },
      {
        fieldName: 'display_name',
        changeType: 'added',
        expected: 'Not present in baseline',
        actual: 'display_name: "Aman Gupta"'
      }
    ],
    affectedFeatures: [
      {
        featureName: 'User Profile Card',
        apiName: 'User Profile API',
        expectedField: 'name',
        impactLevel: 'Critical',
        route: '/profile',
        affectedUsersPercentage: '100%',
        description: 'Profile avatar and greeting widget expecting $.name property.',
        userFacingSymptom: 'Displays "Welcome, undefined" instead of user full name.'
      },
      {
        featureName: 'Team Directory Listing',
        apiName: 'User Profile API',
        expectedField: 'name',
        impactLevel: 'High',
        route: '/team',
        affectedUsersPercentage: '85%',
        description: 'Members table sorting by alphabetized customer name.',
        userFacingSymptom: 'Table column "Name" shows blank cells for newly updated records.'
      }
    ],
    registeredMappings: [
      { feature: 'User Profile Card', api: 'User Profile API', jsonPath: '$.name' },
      { feature: 'User Settings', api: 'User Profile API', jsonPath: '$.email' },
      { feature: 'Team Directory Listing', api: 'User Profile API', jsonPath: '$.name' }
    ],
    proposalId: 'PROP-001',
    assignee: {
      name: 'Alex Rivera',
      role: 'Staff Reliability Engineer'
    }
  },
  {
    id: 'INC-002',
    title: 'Payments Gateway latency spike & 504 Gateway Timeout',
    apiId: 'api-2',
    apiName: 'Payments Gateway API',
    issueType: 'HTTP error',
    severity: 'Critical',
    status: 'Investigating',
    detectedAt: '11 Oct 2026, 12:08 UTC',
    environment: 'Production',
    endpoint: 'https://pay.gateway.net/v1/transactions/tx_8912',
    previousResponse: JSON.stringify({
      status: "success",
      transaction_id: "tx_8912",
      amount: 149.00,
      currency: "USD",
      settled_at: "2026-10-11T12:00:00Z"
    }, null, 2),
    latestResponse: JSON.stringify({
      error: "Gateway Timeout",
      code: 504,
      message: "Upstream clearing house did not respond in 3000ms"
    }, null, 2),
    diffs: [
      {
        fieldName: 'status',
        changeType: 'removed',
        expected: 'status: "success"',
        actual: 'HTTP 504 Gateway Timeout'
      }
    ],
    affectedFeatures: [
      {
        featureName: 'One-Click Checkout',
        apiName: 'Payments Gateway API',
        expectedField: 'status',
        impactLevel: 'Critical',
        route: '/checkout',
        affectedUsersPercentage: '74%',
        description: 'Checkout modal waiting for settlement confirmation.',
        userFacingSymptom: 'Purchases stall on spinner and fail with generic error.'
      }
    ],
    registeredMappings: [
      { feature: 'One-Click Checkout', api: 'Payments Gateway API', jsonPath: '$.status' }
    ],
    assignee: {
      name: 'Elena Rostova',
      role: 'Fintech Infrastructure Lead'
    }
  }
];

export const initialRecoveryProposals: RecoveryProposal[] = [
  {
    id: 'PROP-001',
    incidentId: 'INC-001',
    incidentTitle: 'User API field renamed (name -> display_name)',
    apiName: 'User Profile API',
    proposedSolution: 'Add backwards-compatible response adapter mapping `display_name` into `name` while preserving existing attributes.',
    adapterTransformation: `// API Guardian Gateway Safe Adapter
// Target: User Profile API (v2)
export function transformUserApiResponse(response: any) {
  if (!response || typeof response !== 'object') {
    return response;
  }
  
  // Safe field reconciliation
  return {
    ...response,
    name: response.name ?? response.display_name ?? 'Valued Customer',
    _adaptedBy: 'API Guardian Recovery Engine',
    _adaptedAt: new Date().toISOString()
  };
}`,
    assumptions: [
      'display_name contains identical semantic full name format as original name field.',
      'Downstream features accept standard string values without schema length violations.',
      'Upstream provider did not alter authorization or role payload.'
    ],
    risks: [
      'If upstream temporarily emits both fields with conflicting values, display_name takes precedence.',
      'Requires staging validation test before promoting to edge gateway rule.'
    ],
    status: 'Pending',
    createdAt: '11 Oct 2026, 11:48 UTC',
    targetEnvironment: 'Staging',
    validationResult: {
      runId: 'VAL-RUN-804',
      testName: 'User Profile Downstream Contract Test',
      targetWorkflow: 'User Profile Card Render (/profile)',
      expectedResult: 'Payload contains $.name with non-empty string',
      actualResult: 'Payload passed validation: name = "Aman Gupta"',
      status: 'Passed',
      latencyMs: 14,
      testTime: '11 Oct 2026, 11:52 UTC',
      assertions: [
        { rule: 'Field $.name must be defined', passed: true, expected: 'string', actual: '"Aman Gupta"' },
        { rule: 'Field $.email must match baseline', passed: true, expected: 'aman@example.com', actual: 'aman@example.com' },
        { rule: 'HTTP status must be 200', passed: true, expected: '200', actual: '200' },
        { rule: 'Latency within SLA (<200ms)', passed: true, expected: '<200ms', actual: '14ms' }
      ]
    }
  }
];

export const initialAuditLogs: AuditLogItem[] = [
  {
    id: 'AUD-901',
    timestamp: '11 Oct 2026, 12:15',
    actor: 'Alex Rivera',
    actorType: 'Developer',
    action: 'Validation test executed',
    target: 'User Profile API (Adapter PROP-001)',
    result: 'Success',
    details: 'Executed staging contract test VAL-RUN-804; all 4 assertions passed.',
    metadata: { testId: 'VAL-RUN-804', env: 'Staging', duration: '14ms' }
  },
  {
    id: 'AUD-902',
    timestamp: '11 Oct 2026, 11:48',
    actor: 'System (Guardian AI)',
    actorType: 'System',
    action: 'Repair proposal created',
    target: 'INC-001 (User Profile API)',
    result: 'Success',
    details: 'Generated backwards-compatible adapter mapping display_name to name.',
    metadata: { proposalId: 'PROP-001', fields: ['name', 'display_name'] }
  },
  {
    id: 'AUD-903',
    timestamp: '11 Oct 2026, 11:42',
    actor: 'System (Automated Monitor)',
    actorType: 'System',
    action: 'Incident detected',
    target: 'User Profile API',
    result: 'Success',
    details: 'Detected schema drift: field `name` missing, field `display_name` introduced.',
    metadata: { incidentId: 'INC-001', severity: 'High' }
  },
  {
    id: 'AUD-904',
    timestamp: '11 Oct 2026, 10:30',
    actor: 'Alex Rivera',
    actorType: 'Developer',
    action: 'Baseline approved',
    target: 'Orders & Fulfillment API',
    result: 'Success',
    details: 'Initial healthy JSON response confirmed and committed as schema baseline.',
    metadata: { baselineHash: 'sha256:7b92ac39...', endpoint: '/api/v3/orders/recent' }
  },
  {
    id: 'AUD-905',
    timestamp: '11 Oct 2026, 09:15',
    actor: 'Alex Rivera',
    actorType: 'Developer',
    action: 'API dependency registered',
    target: 'Customer Notification Webhook',
    result: 'Success',
    details: 'Added new GET endpoint monitoring with 30m interval in Development.',
    metadata: { apiId: 'api-6', env: 'Development' }
  },
  {
    id: 'AUD-906',
    timestamp: '10 Oct 2026, 18:00',
    actor: 'System (Security Guard)',
    actorType: 'Security',
    action: 'SSRF verification passed',
    target: 'https://api.external-users.io',
    result: 'Success',
    details: 'Verified public DNS resolution, blocked private RFC1918 loopback addresses.',
    metadata: { resolvedIp: '104.21.84.12' }
  }
];

export const initialMonitoringSettings: MonitoringSettings = {
  defaultInterval: '5m',
  defaultTimeout: 5000,
  defaultEnvironment: 'Production',
  alertSlack: true,
  alertEmail: true,
  alertPagerDuty: false,
  ssrfProtection: true,
  autoBaseline: false
};
