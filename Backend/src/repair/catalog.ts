import type { RepairRuleSpec } from './schemas.js';

/**
 * Built-in example rules. They are *registered* like any other rule (as
 * DRAFT) and must be approved before the matcher may use them; shipping them
 * in code only documents how to write one.
 *
 * To add a rule: write a RepairRuleSpec (validated by repairRuleSpecSchema),
 * add it here or POST it to /api/repair-rules, then approve it with a second
 * actor. Nothing else is needed: the matcher reads approved rules from the
 * store and the engine understands the three transform types.
 */
export const BUILTIN_REPAIR_RULES: RepairRuleSpec[] = [
  {
    key: 'payments.charges.transaction_id-to-payment_reference',
    title: 'Payments renamed transaction_id to payment_reference',
    description: 'Maps the renamed external identifier back onto the internal paymentId. Conflicting values (both fields present and different) are rejected.',
    scope: { provider: 'payments', endpointKey: '*', adapterKey: 'adapter:PaymentsAdapter' },
    match: { findingRules: ['structural.rename_candidate', 'structural.field_removed'], path: 'transaction_id', renamedTo: 'payment_reference' },
    transform: { type: 'rename_field', from: 'transaction_id', renamedTo: 'payment_reference', internalField: 'paymentId', expectedType: 'string' },
    policy: { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false },
    risk: 'LOW',
    requiresHumanReview: true,
    fixtures: [
      { name: 'renamed payload', payload: { payment_reference: 'txn_1', amount: 1250, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: true },
      { name: 'legacy payload still works', payload: { transaction_id: 'txn_1', amount: 1250, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: true },
      { name: 'conflict is rejected', payload: { transaction_id: 'txn_1', payment_reference: 'txn_2', amount: 1, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: false },
    ],
  },
  {
    key: 'payments.charges.amount-to-total',
    title: 'Payments renamed amount to total',
    description: 'Explicit field-path mapping: the validated external `total` feeds the internal `amount`. Negative or non-integer values fail the internal contract.',
    scope: { provider: 'payments', endpointKey: 'POST /charges', adapterKey: 'adapter:PaymentsAdapter' },
    match: { findingRules: ['structural.field_removed', 'structural.rename_candidate'], path: 'amount', renamedTo: 'total' },
    transform: { type: 'field_path_mapping', mappings: [{ from: 'total', internalField: 'amount', expectedType: 'integer' }] },
    policy: { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false },
    risk: 'MEDIUM',
    requiresHumanReview: true,
    fixtures: [
      { name: 'total maps to amount', payload: { transaction_id: 'txn_1', total: 1250, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: true },
      { name: 'string total is rejected', payload: { transaction_id: 'txn_1', total: '1250', currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: false },
      { name: 'negative total fails the internal contract', payload: { transaction_id: 'txn_1', total: -5, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' }, expectOk: false },
    ],
  },
  {
    key: 'shipping.shipments.delivery_status-in_transit',
    title: 'Shipping introduced delivery_status=in_transit',
    description: 'Approved enum mapping: in_transit is treated as the internal `shipped`. Any other new value is rejected, not guessed.',
    scope: { provider: 'shipping', endpointKey: '*', adapterKey: 'adapter:ShippingAdapter' },
    match: { findingRules: ['behavioral.enum_value_changed'], path: 'delivery_status', values: ['in_transit'] },
    transform: {
      type: 'enum_mapping',
      from: 'delivery_status',
      internalField: 'deliveryStatus',
      mapping: { pending: 'pending', shipped: 'shipped', in_transit: 'shipped', delivered: 'delivered' },
      allowedInternalValues: ['pending', 'shipped', 'delivered'],
    },
    policy: { onMissing: 'reject', onNull: 'reject', onTypeMismatch: 'reject', onConflict: 'reject', onExtraFields: 'drop', allowNumericStrings: false },
    risk: 'MEDIUM',
    requiresHumanReview: true,
    fixtures: [
      { name: 'in_transit maps to shipped', payload: { shipment_id: 'shp_1', order_id: 'ord_1', carrier: 'UPS', delivery_status: 'in_transit', estimated_delivery: '2026-10-14' }, expectOk: true },
      { name: 'unknown value is rejected', payload: { shipment_id: 'shp_1', order_id: 'ord_1', carrier: 'UPS', delivery_status: 'lost', estimated_delivery: '2026-10-14' }, expectOk: false },
    ],
  },
];
