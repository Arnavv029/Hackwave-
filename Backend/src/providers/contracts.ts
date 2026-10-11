import { z } from 'zod';

/**
 * Explicit contracts for every provider endpoint the engine knows how to
 * call. A contract states what we EXPECT; observations record what we SEE.
 * Validation results are stored as evidence on the observation and never
 * change the observed values.
 */

export const PROVIDER_KEYS = ['payments', 'shipping'] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
export const providerKeySchema = z.enum(PROVIDER_KEYS);

export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

// ---------------------------------------------------------------------------
// Payments API
// ---------------------------------------------------------------------------

export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 currency code');

export const chargeRequestSchema = z
  .object({
    /** Minor units (cents). Must be positive. */
    amount: z.number().int().positive(),
    currency: currencySchema,
    /** Opaque payment-method token. Never a raw card number. */
    source_token: z.string().min(1),
    idempotency_key: z.string().min(1).max(128).optional(),
    description: z.string().max(200).optional(),
  })
  .strict();
export type ChargeRequest = z.infer<typeof chargeRequestSchema>;

export const chargeSchema = z
  .object({
    transaction_id: z.string().regex(/^txn_[A-Za-z0-9]+$/),
    /** Minor units. Business rule: a charge amount is never negative. */
    amount: z.number().int().nonnegative(),
    currency: currencySchema,
    status: z.enum(['succeeded', 'pending', 'failed']),
    created_at: z.iso.datetime(),
  })
  .strict();
export type Charge = z.infer<typeof chargeSchema>;

// ---------------------------------------------------------------------------
// Shipping API
// ---------------------------------------------------------------------------

/** Statuses the consuming workflows understand. */
export const DELIVERY_STATUSES = ['pending', 'shipped', 'delivered'] as const;

export const shipmentSchema = z
  .object({
    shipment_id: z.string().regex(/^shp_[A-Za-z0-9]+$/),
    order_id: z.string().min(1),
    carrier: z.string().min(1),
    delivery_status: z.enum(DELIVERY_STATUSES),
    estimated_delivery: z.iso.date(),
  })
  .strict();
export type Shipment = z.infer<typeof shipmentSchema>;

export const shipmentListSchema = z
  .object({
    data: z.array(shipmentSchema),
    page: z
      .object({
        number: z.number().int().positive(),
        size: z.number().int().positive(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ShipmentList = z.infer<typeof shipmentListSchema>;

export const shipmentListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().max(1_000).default(1),
    size: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict();

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface EndpointContract {
  method: HttpMethod;
  /** Express-style template, e.g. `/charges/:id`. */
  path: string;
  summary: string;
  /** Status codes the contract considers success. */
  successStatuses: readonly number[];
  /** Zod schema for the JSON request body (POST/PUT/PATCH). */
  requestBody?: z.ZodType;
  /** Zod schema for query parameters. */
  query?: z.ZodType;
  /** Zod schema for a successful JSON response body. */
  response: z.ZodType;
  /** Path parameter names (derived from `path`). */
  pathParams: readonly string[];
}

export interface ProviderContract<E extends string = string> {
  key: ProviderKey;
  name: string;
  /** Name of the secret in the runtime environment; never the secret itself. */
  secretRef: string;
  endpoints: Record<E, EndpointContract>;
}

function endpoint(def: Omit<EndpointContract, 'pathParams'>): EndpointContract {
  const pathParams = [...def.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] ?? '');
  return { ...def, pathParams };
}

export const paymentsContract = {
  key: 'payments',
  name: 'Payments API (mock)',
  secretRef: 'PAYMENTS_API_KEY',
  endpoints: {
    createCharge: endpoint({
      method: 'POST',
      path: '/charges',
      summary: 'Create a charge',
      successStatuses: [200, 201],
      requestBody: chargeRequestSchema,
      response: chargeSchema,
    }),
    getCharge: endpoint({
      method: 'GET',
      path: '/charges/:id',
      summary: 'Fetch a charge by id',
      successStatuses: [200],
      response: chargeSchema,
    }),
  },
} as const satisfies ProviderContract<'createCharge' | 'getCharge'>;

export const shippingContract = {
  key: 'shipping',
  name: 'Shipping API (mock)',
  secretRef: 'SHIPPING_API_KEY',
  endpoints: {
    listShipments: endpoint({
      method: 'GET',
      path: '/shipments',
      summary: 'List shipments (page-number pagination)',
      successStatuses: [200],
      query: shipmentListQuerySchema,
      response: shipmentListSchema,
    }),
    getShipment: endpoint({
      method: 'GET',
      path: '/shipments/:id',
      summary: 'Fetch a shipment by id',
      successStatuses: [200],
      response: shipmentSchema,
    }),
  },
} as const satisfies ProviderContract<'listShipments' | 'getShipment'>;

export const providerContracts: Record<ProviderKey, ProviderContract> = {
  payments: paymentsContract,
  shipping: shippingContract,
};

export type PaymentsEndpoint = keyof typeof paymentsContract.endpoints;
export type ShippingEndpoint = keyof typeof shippingContract.endpoints;

export function getEndpointContract(provider: ProviderKey, endpointName: string): EndpointContract | undefined {
  return providerContracts[provider].endpoints[endpointName];
}

/** `POST /charges` – stable identifier of an endpoint independent of concrete ids. */
export function endpointKey(c: Pick<EndpointContract, 'method' | 'path'>): string {
  return `${c.method} ${c.path}`;
}

/** Graph node key for an operation, matching the Phase 1 convention. */
export function operationNodeKey(provider: ProviderKey, c: Pick<EndpointContract, 'method' | 'path'>): string {
  return `${provider}:${c.method}:${c.path}`;
}

/** Substitute `:param` segments; throws if a parameter is missing or unsafe. */
export function expandPath(template: string, params: Record<string, string>): string {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') throw new Error(`missing path parameter "${name}"`);
    return encodeURIComponent(value);
  });
}
