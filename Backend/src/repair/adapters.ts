import { z } from 'zod';
import type { ValueType } from './schemas.js';

/**
 * Stable internal contracts and the adapters that produce them. The internal
 * contract is what application services depend on; it never changes because a
 * provider renamed a field. An adapter definition is a declarative base
 * mapping from the external payload to the internal contract. Repairs are
 * overlays on that mapping, never edits to it.
 */

export const internalPaymentSchema = z
  .object({
    paymentId: z.string().min(1),
    /** Minor units; the internal contract refuses negatives. */
    amount: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(['succeeded', 'pending', 'failed']),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const internalShipmentSchema = z
  .object({
    shipmentId: z.string().min(1),
    orderId: z.string().min(1),
    carrier: z.string().min(1),
    deliveryStatus: z.enum(['pending', 'shipped', 'delivered']),
    estimatedDelivery: z.iso.date(),
  })
  .strict();

export const INTERNAL_CONTRACTS = {
  Payment: internalPaymentSchema,
  Shipment: internalShipmentSchema,
} as const;
export type InternalContractName = keyof typeof INTERNAL_CONTRACTS;

export interface InternalFieldInfo {
  type: ValueType;
  description: string;
  /** Allowed values for enum-like fields. */
  enum?: string[];
}

/** Human- and machine-readable description of each contract, used to brief the AI and to police its output. */
export const INTERNAL_CONTRACT_FIELDS: Record<InternalContractName, Record<string, InternalFieldInfo>> = {
  Payment: {
    paymentId: { type: 'string', description: 'stable provider payment identifier' },
    amount: { type: 'integer', description: 'minor units, never negative' },
    currency: { type: 'string', description: 'ISO-4217 code, three uppercase letters' },
    status: { type: 'string', description: 'payment state', enum: ['succeeded', 'pending', 'failed'] },
    createdAt: { type: 'string', description: 'ISO-8601 datetime' },
  },
  Shipment: {
    shipmentId: { type: 'string', description: 'stable shipment identifier' },
    orderId: { type: 'string', description: 'internal order identifier' },
    carrier: { type: 'string', description: 'carrier name' },
    deliveryStatus: { type: 'string', description: 'delivery state', enum: ['pending', 'shipped', 'delivered'] },
    estimatedDelivery: { type: 'string', description: 'ISO-8601 date (YYYY-MM-DD)' },
  },
};

export interface BaseMapping {
  /** External dot path. */
  from: string;
  internalField: string;
  expectedType: ValueType;
}

export interface VerificationProbe {
  /** Endpoint name in the provider contract (e.g. `createCharge`). */
  endpointName: string;
  body?: Record<string, unknown>;
  pathParams?: Record<string, string>;
  query?: Record<string, string | number>;
}

export interface AdapterEndpointDefinition {
  endpointKey: string;
  contract: InternalContractName;
  /** External payload -> internal contract, as shipped today. */
  baseMapping: BaseMapping[];
  /**
   * For list endpoints: the path of the array whose items are normalised one
   * by one (each item is treated as a payload). Absent for single objects.
   */
  itemsPath?: string;
  /** How post-activation verification calls the provider (read-only / sandbox-safe calls only). */
  verification: VerificationProbe;
  /** Financial endpoints never get relaxed approval and never run write operations automatically. */
  financial?: boolean;
}

export interface AdapterDefinition {
  key: string;
  provider: string;
  endpoints: Record<string, AdapterEndpointDefinition>;
}

export const paymentsAdapter: AdapterDefinition = {
  key: 'adapter:PaymentsAdapter',
  provider: 'payments',
  endpoints: {
    'POST /charges': {
      endpointKey: 'POST /charges',
      contract: 'Payment',
      financial: true,
      // A sandbox charge against the mock provider; a real deployment would point this at a sandbox/test-mode key.
      verification: { endpointName: 'createCharge', body: { amount: 100, currency: 'USD', source_token: 'tok_verify', idempotency_key: 'driftguard-verify' } },
      baseMapping: [
        { from: 'transaction_id', internalField: 'paymentId', expectedType: 'string' },
        { from: 'amount', internalField: 'amount', expectedType: 'integer' },
        { from: 'currency', internalField: 'currency', expectedType: 'string' },
        { from: 'status', internalField: 'status', expectedType: 'string' },
        { from: 'created_at', internalField: 'createdAt', expectedType: 'string' },
      ],
    },
    'GET /charges/:id': {
      endpointKey: 'GET /charges/:id',
      contract: 'Payment',
      financial: true,
      verification: { endpointName: 'getCharge', pathParams: { id: 'txn_verify' } },
      baseMapping: [
        { from: 'transaction_id', internalField: 'paymentId', expectedType: 'string' },
        { from: 'amount', internalField: 'amount', expectedType: 'integer' },
        { from: 'currency', internalField: 'currency', expectedType: 'string' },
        { from: 'status', internalField: 'status', expectedType: 'string' },
        { from: 'created_at', internalField: 'createdAt', expectedType: 'string' },
      ],
    },
  },
};

export const shippingAdapter: AdapterDefinition = {
  key: 'adapter:ShippingAdapter',
  provider: 'shipping',
  endpoints: {
    'GET /shipments': {
      endpointKey: 'GET /shipments',
      contract: 'Shipment',
      itemsPath: 'data',
      verification: { endpointName: 'listShipments', query: { page: 1, size: 5 } },
      baseMapping: [
        { from: 'shipment_id', internalField: 'shipmentId', expectedType: 'string' },
        { from: 'order_id', internalField: 'orderId', expectedType: 'string' },
        { from: 'carrier', internalField: 'carrier', expectedType: 'string' },
        { from: 'delivery_status', internalField: 'deliveryStatus', expectedType: 'string' },
        { from: 'estimated_delivery', internalField: 'estimatedDelivery', expectedType: 'string' },
      ],
    },
    'GET /shipments/:id': {
      endpointKey: 'GET /shipments/:id',
      contract: 'Shipment',
      verification: { endpointName: 'getShipment', pathParams: { id: 'shp_1001' } },
      baseMapping: [
        { from: 'shipment_id', internalField: 'shipmentId', expectedType: 'string' },
        { from: 'order_id', internalField: 'orderId', expectedType: 'string' },
        { from: 'carrier', internalField: 'carrier', expectedType: 'string' },
        { from: 'delivery_status', internalField: 'deliveryStatus', expectedType: 'string' },
        { from: 'estimated_delivery', internalField: 'estimatedDelivery', expectedType: 'string' },
      ],
    },
  },
};

export const ADAPTERS: Record<string, AdapterDefinition> = {
  [paymentsAdapter.key]: paymentsAdapter,
  [shippingAdapter.key]: shippingAdapter,
};

export function findAdapterEndpoint(adapterKey: string, endpointKey: string): AdapterEndpointDefinition | undefined {
  return ADAPTERS[adapterKey]?.endpoints[endpointKey];
}

/** Adapters that normalise a given provider endpoint. */
export function adaptersForEndpoint(provider: string, endpointKey: string): AdapterDefinition[] {
  return Object.values(ADAPTERS).filter((a) => a.provider === provider && a.endpoints[endpointKey] !== undefined);
}
