import { MetricCardData, ResponseTimeDataPoint, ServiceItem, TrafficDataPoint, UserProfile } from '../types';

export const initialUserProfile: UserProfile = {
  name: 'Akash Bonik',
  email: 'akash@zerdeeps.com',
  role: 'DevOps Lead',
  organization: 'Zerdeeps Cloud Infrastructure'
};

export const initialMetricCards: MetricCardData[] = [
  {
    id: 'uptime',
    title: 'Total Uptime',
    value: '99.98%',
    change: '+2%',
    changeType: 'positive',
    comparisonText: 'Than last day',
    visible: true,
  },
  {
    id: 'monitors',
    title: 'Active Monitors',
    value: '24',
    change: '+5%',
    changeType: 'positive',
    comparisonText: 'Than last day',
    visible: true,
  },
  {
    id: 'response_time',
    title: 'Avg Response Time',
    value: '142ms',
    change: '+10%',
    changeType: 'positive',
    comparisonText: 'Than last day',
    visible: true,
  },
  {
    id: 'incidents',
    title: 'Total Incidents',
    value: '3',
    change: '+2%',
    changeType: 'negative',
    comparisonText: 'Than last day',
    visible: true,
  },
];

export const initialTrafficData: TrafficDataPoint[] = [
  { date: '2026-11-11', label: 'Nov 11', volume: 4200 },
  { date: '2026-11-12', label: 'Nov 12', volume: 3850 },
  { date: '2026-11-13', label: 'Nov 13', volume: 4800 },
  { date: '2026-11-14', label: 'Nov 14', volume: 4320 },
  { date: '2026-11-15', label: 'Nov 15', volume: 5120 },
  { date: '2026-11-16', label: 'Nov 16', volume: 6420 },
  { date: '2026-11-17', label: 'Nov 17', volume: 5850 },
  { date: '2026-11-18', label: 'Nov 18', volume: 6300 },
];

export const initialResponseTimes: ResponseTimeDataPoint[] = [
  { time: '00:00', avgLatency: 118, peakLatency: 142 },
  { time: '04:00', avgLatency: 132, peakLatency: 156 },
  { time: '08:00', avgLatency: 160, peakLatency: 182 },
  { time: '12:00', avgLatency: 174, peakLatency: 198 },
  { time: '16:00', avgLatency: 192, peakLatency: 215 },
  { time: '20:00', avgLatency: 155, peakLatency: 178 },
  { time: '23:59', avgLatency: 142, peakLatency: 168 },
];

export const initialServices: ServiceItem[] = [
  {
    id: 'srv-1',
    status: 'Up',
    name: 'Main Website',
    url: 'https://example.com',
    uptime: '100%',
    response: '142ms',
    uptimeNumeric: 100,
    responseNumeric: 142,
    category: 'Web',
    sslExpiresIn: '84 days',
    statusMessage: 'All edge CDN caches warmed up and responding within SLA'
  },
  {
    id: 'srv-2',
    status: 'Up',
    name: 'API Server',
    url: 'https://api.example.com',
    uptime: '99.99%',
    response: '89ms',
    uptimeNumeric: 99.99,
    responseNumeric: 89,
    category: 'API',
    sslExpiresIn: '112 days',
    statusMessage: 'Core GraphQL & REST gateway nominal'
  },
  {
    id: 'srv-3',
    status: 'Up',
    name: 'CDN',
    url: 'https://cdn.example.com',
    uptime: '100%',
    response: '45ms',
    uptimeNumeric: 100,
    responseNumeric: 45,
    category: 'Infrastructure',
    sslExpiresIn: '210 days',
    statusMessage: 'Global points of presence (PoP) optimal'
  },
  {
    id: 'srv-4',
    status: 'Up',
    name: 'Database',
    url: 'db.example.com',
    uptime: '99.55%',
    response: '12ms',
    uptimeNumeric: 99.55,
    responseNumeric: 12,
    category: 'Database',
    sslExpiresIn: 'Internal TLS',
    statusMessage: 'Read replica pool latency under 15ms'
  },
  {
    id: 'srv-5',
    status: 'Degraded',
    name: 'Storage Service',
    url: 'storage.example.com',
    uptime: '98.2%',
    response: '256ms',
    uptimeNumeric: 98.2,
    responseNumeric: 256,
    category: 'Storage',
    sslExpiresIn: '65 days',
    lastIncident: 'S3 chunk replication re-indexing in progress',
    statusMessage: 'Higher tail latency observed on multi-region object writes'
  },
  {
    id: 'srv-6',
    status: 'Up',
    name: 'Email Service',
    url: 'mail.example.com',
    uptime: '99.98%',
    response: '178ms',
    uptimeNumeric: 99.98,
    responseNumeric: 178,
    category: 'Communication',
    sslExpiresIn: '140 days',
    statusMessage: 'Transactional SMTP outbound queues processing normally'
  },
];
