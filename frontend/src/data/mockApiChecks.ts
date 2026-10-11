import { ApiCheckItem } from '../types';

// Helper to generate 40 timeline bars
const generateBars = (type: 'all-green' | 'mostly-green-with-warn' | 'failing' | 'paused'): ('success' | 'warning' | 'error' | 'empty')[] => {
  const bars: ('success' | 'warning' | 'error' | 'empty')[] = [];
  for (let i = 0; i < 38; i++) {
    if (type === 'all-green') {
      bars.push('success');
    } else if (type === 'mostly-green-with-warn') {
      if (i > 32) {
        bars.push(i % 2 === 0 ? 'warning' : 'error');
      } else {
        bars.push('success');
      }
    } else if (type === 'failing') {
      bars.push(i % 3 === 0 ? 'success' : 'error');
    } else if (type === 'paused') {
      bars.push(i > 15 ? 'empty' : 'warning');
    }
  }
  return bars;
};

export const initialApiChecks: ApiCheckItem[] = [
  {
    id: 'api-1',
    name: 'Create Order',
    url: 'https://api.xitoring.com/v1/orders',
    method: 'POST',
    status: 'Degraded',
    timeline: generateBars('mostly-green-with-warn'),
    successRate: '96.5%',
    successRateNumeric: 96.5,
    avgLatency: '890ms',
    avgLatencyNumeric: 890,
    assertionsPassed: 3,
    assertionsTotal: 4,
    lastCheck: '15 minutes ago',
    expectedStatus: 201,
    interval: '5 minutes',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer xit_sec_***'
    },
    bodySnippet: '{"items":[{"sku":"PRO-102","qty":2}],"currency":"USD"}',
    assertionsList: [
      { rule: 'Status code is 201 Created', passed: true },
      { rule: 'Response time < 500ms', passed: false },
      { rule: 'Body contains order_id', passed: true },
      { rule: 'Header Content-Type is application/json', passed: true },
    ]
  },
  {
    id: 'api-2',
    name: 'Get Metrics',
    url: 'https://api.xitoring.com/v1/metrics',
    method: 'GET',
    status: 'Healthy',
    timeline: generateBars('all-green'),
    successRate: '99.5%',
    successRateNumeric: 99.5,
    avgLatency: '320ms',
    avgLatencyNumeric: 320,
    assertionsPassed: 3,
    assertionsTotal: 3,
    lastCheck: '14 minutes ago',
    expectedStatus: 200,
    interval: '1 minute',
    headers: {
      'Accept': 'application/json'
    },
    assertionsList: [
      { rule: 'Status code is 200 OK', passed: true },
      { rule: 'Response time < 400ms', passed: true },
      { rule: 'JSON schema validation passed', passed: true },
    ]
  },
  {
    id: 'api-3',
    name: 'Health Check',
    url: 'https://api.xitoring.com/v1/health',
    method: 'GET',
    status: 'Healthy',
    timeline: generateBars('all-green'),
    successRate: '100.0%',
    successRateNumeric: 100.0,
    avgLatency: '42ms',
    avgLatencyNumeric: 42,
    assertionsPassed: 3,
    assertionsTotal: 3,
    lastCheck: '13 minutes ago',
    expectedStatus: 200,
    interval: '30 seconds',
    assertionsList: [
      { rule: 'Status code is 200 OK', passed: true },
      { rule: 'Body status equals "healthy"', passed: true },
      { rule: 'Response time < 100ms', passed: true },
    ]
  },
  {
    id: 'api-4',
    name: 'List Servers',
    url: 'https://api.xitoring.com/v1/servers',
    method: 'GET',
    status: 'Healthy',
    timeline: generateBars('all-green'),
    successRate: '99.9%',
    successRateNumeric: 99.9,
    avgLatency: '210ms',
    avgLatencyNumeric: 210,
    assertionsPassed: 3,
    assertionsTotal: 3,
    lastCheck: '14 minutes ago',
    expectedStatus: 200,
    interval: '2 minutes',
    assertionsList: [
      { rule: 'Status code is 200 OK', passed: true },
      { rule: 'Array servers length > 0', passed: true },
      { rule: 'Response time < 350ms', passed: true },
    ]
  },
  {
    id: 'api-5',
    name: 'Search Incidents',
    url: 'https://api.xitoring.com/v1/incidents/search',
    method: 'POST',
    status: 'Paused',
    timeline: generateBars('paused'),
    successRate: '—',
    successRateNumeric: null,
    avgLatency: '—',
    avgLatencyNumeric: null,
    assertionsPassed: 0,
    assertionsTotal: 1,
    lastCheck: '1 day ago',
    expectedStatus: 200,
    interval: 'Paused',
    bodySnippet: '{"query":"status:critical","limit":20}',
    assertionsList: [
      { rule: 'Status code is 200 OK', passed: false },
    ]
  },
  {
    id: 'api-6',
    name: 'User Authentication',
    url: 'https://api.xitoring.com/v1/auth/login',
    method: 'POST',
    status: 'Healthy',
    timeline: generateBars('all-green'),
    successRate: '99.8%',
    successRateNumeric: 99.8,
    avgLatency: '145ms',
    avgLatencyNumeric: 145,
    assertionsPassed: 4,
    assertionsTotal: 4,
    lastCheck: '14 minutes ago',
    expectedStatus: 200,
    interval: '5 minutes',
    bodySnippet: '{"client_id":"xit-synth-agent"}',
    assertionsList: [
      { rule: 'Status code is 200 OK', passed: true },
      { rule: 'Response body contains token', passed: true },
      { rule: 'Expires_in is present and > 3600', passed: true },
      { rule: 'Response time < 250ms', passed: true },
    ]
  },
  {
    id: 'api-7',
    name: 'User Profile',
    url: 'https://api.xitoring.com/v1/users/me',
    method: 'GET',
    status: 'Healthy',
    timeline: generateBars('all-green'),
    successRate: '100.0%',
    successRateNumeric: 100.0,
    avgLatency: '98ms',
    avgLatencyNumeric: 98,
    assertionsPassed: 2,
    assertionsTotal: 2,
    lastCheck: '14 minutes ago',
    expectedStatus: 200,
    interval: '2 minutes',
    assertionsList: [
      { rule: 'Status code is 200 OK', passed: true },
      { rule: 'Body contains email and user_id', passed: true },
    ]
  },
  {
    id: 'api-8',
    name: 'Webhook Delivery',
    url: 'https://hooks.xitoring.com/v1/send',
    method: 'POST',
    status: 'Failing',
    timeline: generateBars('failing'),
    successRate: '42.0%',
    successRateNumeric: 42.0,
    avgLatency: '—',
    avgLatencyNumeric: null,
    assertionsPassed: 0,
    assertionsTotal: 3,
    lastCheck: '16 minutes ago',
    expectedStatus: 202,
    interval: '1 minute',
    bodySnippet: '{"event":"ping.test","timestamp":1728574200}',
    assertionsList: [
      { rule: 'Status code is 202 Accepted', passed: false },
      { rule: 'Header X-Delivery-Ack present', passed: false },
      { rule: 'Response time < 600ms', passed: false },
    ]
  },
];
