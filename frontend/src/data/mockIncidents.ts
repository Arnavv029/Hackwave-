import { Incident } from '../types';

export const initialIncidents: Incident[] = [
  {
    id: 'INC-2025-089',
    title: 'Authentication & Login Gateway Degradation',
    priority: 'P1',
    created: '10/10/2026, 15:20:00',
    region: 'us-east-1',
    status: 'Investigating',
    service: 'auth-service',
    assignee: {
      name: 'Alex Rivera',
      role: 'Staff Reliability Engineer'
    },
    impact: 'User facing',
    slackChannel: '#incident-auth-gateway',
    affectedComponents: [
      {
        id: 'comp-1',
        name: 'Login Page',
        type: 'Page',
        route: '/login',
        impactLevel: 'Critical',
        affectedUsersPercentage: '100%',
        description: 'Direct customer portal entry point',
        userFacingSymptom: 'Submitting credentials hangs for 30s then returns HTTP 504 Gateway Timeout',
        statusBadge: 'Completely Blocked'
      },
      {
        id: 'comp-2',
        name: 'User Profile & Session Dropdown',
        type: 'Component',
        route: 'Global Navbar',
        impactLevel: 'Degraded',
        affectedUsersPercentage: '45%',
        description: 'Authenticated header widget and organization switcher',
        userFacingSymptom: 'Session token refresh fails silently; displays read-only cached avatar',
        statusBadge: 'Degraded'
      },
      {
        id: 'comp-3',
        name: 'SSO OAuth Callback Handler',
        type: 'API Flow',
        route: '/auth/sso/callback',
        impactLevel: 'Broken',
        affectedUsersPercentage: '100%',
        description: 'Google Workspace and GitHub corporate Single Sign-On',
        userFacingSymptom: 'Callback redirect loop resulting in "Invalid Session Grant" toast',
        statusBadge: 'Offline'
      },
      {
        id: 'comp-4',
        name: 'Checkout Auth Guard',
        type: 'Component',
        route: '/checkout',
        impactLevel: 'Critical',
        affectedUsersPercentage: '68%',
        description: 'Cart authentication verification prior to payment submission',
        userFacingSymptom: 'Returning registered buyers cannot sign in to complete transactions',
        statusBadge: 'Revenue Impact'
      },
      {
        id: 'comp-5',
        name: 'Admin Console Access Guard',
        type: 'Page',
        route: '/admin/*',
        impactLevel: 'Critical',
        affectedUsersPercentage: '100%',
        description: 'Internal operations backoffice portal',
        userFacingSymptom: 'MFA 2-Factor push prompt timed out; ops engineers unable to access console',
        statusBadge: 'High Risk'
      }
    ],
    timeline: [
      {
        id: 't-1',
        actorType: 'agent',
        actorName: 'Metrics Agent',
        eventType: 'METRICSPIKE',
        time: '15:20:00',
        content: 'Detected Error Rate > 8% for auth-service over 5m window. Auth pool thread utilization spiked to 98%.'
      },
      {
        id: 't-2',
        actorType: 'system',
        actorName: 'System',
        eventType: 'STATUSCHANGE',
        time: '15:21:00',
        content: 'Incident created. Status: Open. Auto-paged on-call rotation (#incident-auth-gateway).'
      },
      {
        id: 't-3',
        actorType: 'user',
        actorName: 'Alex Rivera',
        eventType: 'STATUSCHANGE',
        time: '15:25:00',
        content: 'Changed status to Investigating.'
      },
      {
        id: 't-4',
        actorType: 'user',
        actorName: 'Alex Rivera',
        eventType: 'COMMENT',
        time: '15:26:00',
        content: 'Checking session cluster logs. Looks like Redis token cache connection starvation following canary rollout v3.8.2.'
      },
      {
        id: 't-5',
        actorType: 'agent',
        actorName: 'Log Analyzer Agent',
        eventType: 'LOGANALYSIS',
        time: '15:27:00',
        content: 'Found 620+ occurrences of "RedisConnectionPoolExhaustedException" in last 10 minutes correlated with /api/v1/auth/login latency.'
      }
    ],
    remediations: [
      {
        id: 'rem-1',
        title: 'Rollback to auth-service v3.8.1',
        description: 'Suggested by Remediation Agent (94% confidence)',
        confidence: 94,
        recommended: true,
        type: 'automated'
      },
      {
        id: 'rem-2',
        title: 'Increase Redis max-connections pool to 500',
        description: 'Manual mitigation suggestion',
        confidence: 78,
        type: 'manual'
      },
      {
        id: 'rem-3',
        title: 'Enable stateless JWT fallback mode',
        description: 'Bypasses session store for existing active cookies',
        confidence: 85,
        type: 'automated'
      }
    ]
  },
  {
    id: 'INC-2025-041',
    title: 'Increased error rate on checkout API',
    priority: 'P1',
    created: '12/05/2025, 04:30:00',
    region: 'us-east-1',
    status: 'Investigating',
    service: 'checkout-service',
    assignee: {
      name: 'Alex Rivera',
      role: 'Staff Reliability Engineer'
    },
    impact: 'User facing',
    slackChannel: '#incident-checkout-p1',
    affectedComponents: [
      {
        id: 'comp-10',
        name: 'Checkout Page',
        type: 'Page',
        route: '/checkout',
        impactLevel: 'Critical',
        affectedUsersPercentage: '78%',
        description: 'Primary customer payment funnel',
        userFacingSymptom: 'Credit card tokenization fails with timeout 504 on step 3',
        statusBadge: 'Revenue Impact'
      },
      {
        id: 'comp-11',
        name: 'Cart Slide-over Drawer',
        type: 'Component',
        route: 'Global Layout',
        impactLevel: 'Degraded',
        affectedUsersPercentage: '40%',
        description: 'Mini-cart slideout across all product pages',
        userFacingSymptom: '"Proceed to Checkout" button spinner runs indefinitely',
        statusBadge: 'Degraded'
      },
      {
        id: 'comp-12',
        name: 'One-Click Buy Widget',
        type: 'Component',
        route: '/products/*',
        impactLevel: 'Broken',
        affectedUsersPercentage: '100%',
        description: 'Express checkout on product detail pages',
        userFacingSymptom: 'Apple Pay and Google Pay express buttons disabled',
        statusBadge: 'Offline'
      },
      {
        id: 'comp-13',
        name: 'Subscription Auto-Renew Engine',
        type: 'API Flow',
        route: '/billing/renew',
        impactLevel: 'Degraded',
        affectedUsersPercentage: '18%',
        description: 'Recurring cron subscription charger',
        userFacingSymptom: 'Batch transactions deferred to dead-letter queue for retry',
        statusBadge: 'Retrying'
      }
    ],
    timeline: [
      {
        id: 't-11',
        actorType: 'agent',
        actorName: 'Metrics Agent',
        eventType: 'METRICSPIKE',
        time: '04:30:00',
        content: 'Detected Error Rate > 5% for checkout-service over 5m window.'
      },
      {
        id: 't-12',
        actorType: 'system',
        actorName: 'System',
        eventType: 'STATUSCHANGE',
        time: '04:31:00',
        content: 'Incident created. Status: Open.'
      },
      {
        id: 't-13',
        actorType: 'user',
        actorName: 'Alex Rivera',
        eventType: 'STATUSCHANGE',
        time: '04:35:00',
        content: 'Changed status to Investigating.'
      },
      {
        id: 't-14',
        actorType: 'user',
        actorName: 'Alex Rivera',
        eventType: 'COMMENT',
        time: '04:35:30',
        content: 'Checking deployment logs now. Looks like the new canary build might be the cause.'
      },
      {
        id: 't-15',
        actorType: 'agent',
        actorName: 'Log Analyzer Agent',
        eventType: 'LOGANALYSIS',
        time: '04:36:00',
        content: 'Found 400+ occurrences of "PaymentGatewayTimeoutException" in last 10 minutes correlated with checkout failures.'
      }
    ],
    remediations: [
      {
        id: 'rem-10',
        title: 'Rollback to v2.4.5',
        description: 'Suggested by Remediation Agent (92% confidence)',
        confidence: 92,
        recommended: true,
        type: 'automated'
      },
      {
        id: 'rem-11',
        title: 'Increase timeout to 30s',
        description: 'Manual suggestion',
        confidence: 65,
        type: 'manual'
      }
    ]
  }
];
