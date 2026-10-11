import type { CreateEdgeInput, CreateNodeInput } from './schemas.js';

/**
 * Sample graph for the commerce demo (see docs/DEMO.md). Keys for providers
 * and operations match what the observation engine creates, so loading the
 * fixture on top of recorded observations merges rather than duplicates.
 *
 * Direction: upstream -> downstream. Includes a shared dependency
 * (ReportingService uses both adapters), a cycle (OrderTracking <-> Notification),
 * an INFERRED edge, a disconnected node and an operation with no consumers.
 */
export interface GraphFixture {
  name: string;
  description: string;
  nodes: CreateNodeInput[];
  edges: CreateEdgeInput[];
}

const node = (n: Partial<CreateNodeInput> & Pick<CreateNodeInput, 'kind' | 'key' | 'name'>): CreateNodeInput => ({
  enabled: true,
  criticality: 'MEDIUM',
  metadata: {},
  ...n,
});
const edge = (e: Partial<CreateEdgeInput> & Pick<CreateEdgeInput, 'from' | 'to' | 'relation'>): CreateEdgeInput => ({
  provenance: 'MANUAL',
  consumedFields: [],
  metadata: {},
  ...e,
});

export const commerceDemoFixture: GraphFixture = {
  name: 'commerce-demo',
  description: 'Payments + Shipping providers feeding checkout, order tracking and reporting workflows with regression tests.',
  nodes: [
    node({ kind: 'PROVIDER', key: 'payments', name: 'Payments API (mock)', secretRef: 'PAYMENTS_API_KEY' }),
    node({ kind: 'OPERATION', key: 'payments:POST:/charges', name: 'POST /charges', parentKey: 'payments', method: 'POST', path: '/charges' }),
    node({ kind: 'OPERATION', key: 'payments:GET:/charges/:id', name: 'GET /charges/:id', parentKey: 'payments', method: 'GET', path: '/charges/:id' }),
    node({ kind: 'PROVIDER', key: 'shipping', name: 'Shipping API (mock)', secretRef: 'SHIPPING_API_KEY' }),
    node({ kind: 'OPERATION', key: 'shipping:GET:/shipments', name: 'GET /shipments', parentKey: 'shipping', method: 'GET', path: '/shipments' }),
    node({ kind: 'OPERATION', key: 'shipping:GET:/shipments/:id', name: 'GET /shipments/:id', parentKey: 'shipping', method: 'GET', path: '/shipments/:id' }),
    // A provider whose operation nobody consumes yet ("missing edges").
    node({ kind: 'PROVIDER', key: 'users', name: 'Users API' }),
    node({ kind: 'OPERATION', key: 'users:GET:/users', name: 'GET /users', parentKey: 'users', method: 'GET', path: '/users' }),

    node({ kind: 'ADAPTER', key: 'adapter:PaymentsAdapter', name: 'PaymentsAdapter', metadata: { module: 'src/adapters/payments.ts' } }),
    node({ kind: 'ADAPTER', key: 'adapter:ShippingAdapter', name: 'ShippingAdapter', metadata: { module: 'src/adapters/shipping.ts' } }),

    node({ kind: 'SERVICE', key: 'service:CheckoutService', name: 'CheckoutService', criticality: 'CRITICAL' }),
    node({ kind: 'SERVICE', key: 'service:OrderTrackingService', name: 'OrderTrackingService', criticality: 'HIGH' }),
    node({ kind: 'SERVICE', key: 'service:NotificationService', name: 'NotificationService' }),
    node({ kind: 'SERVICE', key: 'service:ReportingService', name: 'ReportingService', criticality: 'LOW' }),
    // Disconnected: registered but no edges.
    node({ kind: 'SERVICE', key: 'service:LegacyInventoryService', name: 'LegacyInventoryService', enabled: false }),

    node({ kind: 'WORKFLOW', key: 'workflow:checkout', name: 'Checkout', criticality: 'CRITICAL' }),
    node({ kind: 'WORKFLOW', key: 'workflow:refund', name: 'Refund', criticality: 'HIGH' }),
    node({ kind: 'WORKFLOW', key: 'workflow:order-tracking', name: 'Order tracking', criticality: 'HIGH' }),
    node({ kind: 'WORKFLOW', key: 'workflow:finance-report', name: 'Finance report', criticality: 'LOW' }),

    node({ kind: 'TEST', key: 'test:checkout-regression', name: 'checkout.regression.spec', metadata: { command: 'npm run test:workflows -- checkout' } }),
    node({ kind: 'TEST', key: 'test:refund-regression', name: 'refund.regression.spec' }),
    node({ kind: 'TEST', key: 'test:order-tracking-regression', name: 'order-tracking.regression.spec' }),
    node({ kind: 'TEST', key: 'test:payments-adapter-contract', name: 'payments-adapter.contract.spec' }),
    node({ kind: 'TEST', key: 'test:finance-report-smoke', name: 'finance-report.smoke.spec' }),
  ],
  edges: [
    edge({ from: 'payments', to: 'payments:POST:/charges', relation: 'EXPOSES', provenance: 'OBSERVED' }),
    edge({ from: 'payments', to: 'payments:GET:/charges/:id', relation: 'EXPOSES', provenance: 'OBSERVED' }),
    edge({ from: 'shipping', to: 'shipping:GET:/shipments', relation: 'EXPOSES', provenance: 'OBSERVED' }),
    edge({ from: 'shipping', to: 'shipping:GET:/shipments/:id', relation: 'EXPOSES', provenance: 'OBSERVED' }),
    edge({ from: 'users', to: 'users:GET:/users', relation: 'EXPOSES' }),

    edge({ from: 'payments:POST:/charges', to: 'adapter:PaymentsAdapter', relation: 'NORMALIZES', consumedFields: ['transaction_id', 'amount', 'currency', 'status'], note: 'maps transaction_id -> internal paymentId' }),
    edge({ from: 'payments:GET:/charges/:id', to: 'adapter:PaymentsAdapter', relation: 'NORMALIZES', consumedFields: ['transaction_id', 'status'] }),
    edge({ from: 'shipping:GET:/shipments', to: 'adapter:ShippingAdapter', relation: 'NORMALIZES', consumedFields: ['data[].shipment_id', 'data[].delivery_status', 'data[].estimated_delivery', 'page.number', 'page.total'], note: 'switches on delivery_status' }),
    edge({ from: 'shipping:GET:/shipments/:id', to: 'adapter:ShippingAdapter', relation: 'NORMALIZES', consumedFields: ['shipment_id', 'delivery_status'] }),
    // Reporting reads charges directly (no normalisation) and we only know it from log mining.
    edge({ from: 'payments:GET:/charges/:id', to: 'service:ReportingService', relation: 'CALLS', provenance: 'INFERRED', confidence: 0.6, note: 'seen in access logs; field use unknown' }),

    edge({ from: 'adapter:PaymentsAdapter', to: 'service:CheckoutService', relation: 'USES' }),
    edge({ from: 'adapter:PaymentsAdapter', to: 'service:ReportingService', relation: 'USES' }),
    edge({ from: 'adapter:ShippingAdapter', to: 'service:OrderTrackingService', relation: 'USES' }),
    edge({ from: 'adapter:ShippingAdapter', to: 'service:ReportingService', relation: 'USES', provenance: 'INFERRED', confidence: 0.5 }),

    edge({ from: 'service:CheckoutService', to: 'workflow:checkout', relation: 'FEEDS_INTO' }),
    edge({ from: 'service:CheckoutService', to: 'workflow:refund', relation: 'FEEDS_INTO' }),
    edge({ from: 'service:OrderTrackingService', to: 'workflow:order-tracking', relation: 'FEEDS_INTO' }),
    edge({ from: 'service:OrderTrackingService', to: 'service:NotificationService', relation: 'FEEDS_INTO', note: 'status change notifications' }),
    edge({ from: 'service:NotificationService', to: 'service:OrderTrackingService', relation: 'FEEDS_INTO', note: 'delivery receipts (cycle)' }),
    edge({ from: 'service:ReportingService', to: 'workflow:finance-report', relation: 'FEEDS_INTO' }),

    edge({ from: 'workflow:checkout', to: 'test:checkout-regression', relation: 'COVERED_BY' }),
    edge({ from: 'workflow:refund', to: 'test:refund-regression', relation: 'COVERED_BY' }),
    edge({ from: 'workflow:order-tracking', to: 'test:order-tracking-regression', relation: 'COVERED_BY' }),
    edge({ from: 'adapter:PaymentsAdapter', to: 'test:payments-adapter-contract', relation: 'COVERED_BY' }),
    edge({ from: 'workflow:finance-report', to: 'test:finance-report-smoke', relation: 'COVERED_BY' }),
  ],
};

export const GRAPH_FIXTURES: Record<string, GraphFixture> = { [commerceDemoFixture.name]: commerceDemoFixture };
