import { describe, expect, it } from 'vitest';
import { normalize, hash } from '../../src/repair/engine.js';
import { paymentsAdapter, shippingAdapter } from '../../src/repair/adapters.js';
import { policySchema, repairRuleSpecSchema, transformSchema, type Policy, type Transform } from '../../src/repair/schemas.js';
import { BUILTIN_REPAIR_RULES } from '../../src/repair/catalog.js';

const charges = paymentsAdapter.endpoints['POST /charges']!;
const shipments = shippingAdapter.endpoints['GET /shipments']!;
const shipment = shippingAdapter.endpoints['GET /shipments/:id']!;
const P: Policy = policySchema.parse({});
const base = { transaction_id: 'txn_1', amount: 1250, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' };
const internal = { paymentId: 'txn_1', amount: 1250, currency: 'USD', status: 'succeeded', createdAt: '2026-10-11T00:00:00.000Z' };
const rename: Transform = { type: 'rename_field', from: 'transaction_id', renamedTo: 'payment_reference', internalField: 'paymentId', expectedType: 'string' };
const total: Transform = { type: 'field_path_mapping', mappings: [{ from: 'total', internalField: 'amount', expectedType: 'integer' }] };
const enumMap: Transform = { type: 'enum_mapping', from: 'delivery_status', internalField: 'deliveryStatus', mapping: { pending: 'pending', shipped: 'shipped', in_transit: 'shipped', delivered: 'delivered' }, allowedInternalValues: ['pending', 'shipped', 'delivered'] };
const run = (payload: unknown, transforms: Transform[] = [], policy: Partial<Policy> = {}, definition = charges) => normalize({ definition, payload, transforms, policy: { ...P, ...policy } });
const codes = (r: ReturnType<typeof run>) => r.rejections.map((x) => x.code);

describe('base adapter (no repair)', () => {
  it('maps the external payload onto the internal contract and drops unknown fields', () => {
    const r = run({ ...base, experimental_flag: true });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(internal);
    expect(r.droppedFields).toEqual(['experimental_flag']);
    expect(r.contractValid).toBe(true);
    expect(r.trace.at(-1)).toMatchObject({ step: 'contract.validated' });
  });

  it('rejects when the provider renamed a field and no repair is active', () => {
    const { transaction_id: _t, ...rest } = base;
    const r = run({ payment_reference: 'txn_1', ...rest });
    expect(r.ok).toBe(false);
    expect(r.rejections).toEqual([{ code: 'MISSING_FIELD', path: 'transaction_id', message: expect.stringContaining('paymentId') as unknown }]);
    expect(r.output).toBeNull();
  });

  it('rejects non-object payloads, missing list arrays and bad list items', () => {
    expect(codes(run('nope'))).toEqual(['INVALID_PAYLOAD']);
    expect(codes(run([base]))).toEqual(['INVALID_PAYLOAD']);
    expect(codes(run({ page: {} }, [], {}, shipments))).toEqual(['INVALID_PAYLOAD']);
    expect(codes(run({ data: [1] }, [], {}, shipments))).toEqual(['INVALID_PAYLOAD']);
  });

  it('never mutates its input and is reproducible', () => {
    const payload = { ...base, nested: { a: 1 } };
    const snapshot = JSON.stringify(payload);
    const a = run(payload);
    const b = run(payload);
    expect(JSON.stringify(payload)).toBe(snapshot);
    expect(a.outputHash).toBe(b.outputHash);
    expect(a.inputHash).toBe(hash(payload));
    expect(hash({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(hash({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
});

describe('rule 1: rename_field', () => {
  const renamed = { payment_reference: 'txn_9', amount: 5, currency: 'EUR', status: 'pending', created_at: '2026-10-11T00:00:00.000Z' };

  it('reads the renamed field into the stable internal field', () => {
    const r = run(renamed, [rename]);
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ paymentId: 'txn_9', amount: 5 });
    expect(r.trace).toContainEqual({ step: 'apply.mapped', detail: { internalField: 'paymentId', from: 'payment_reference', role: 'renamed' } });
  });

  it('is idempotent for payloads that still use the old name', () => {
    const r = run(base, [rename]);
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(internal);
  });

  it('rejects when both names are present with different values, unless a preference is explicit', () => {
    const both = { ...renamed, transaction_id: 'txn_other' };
    expect(codes(run(both, [rename]))).toEqual(['CONFLICTING_VALUES']);
    expect((run(both, [rename], { onConflict: 'prefer_new' }).output as { paymentId: string }).paymentId).toBe('txn_9');
    expect((run(both, [rename], { onConflict: 'prefer_old' }).output as { paymentId: string }).paymentId).toBe('txn_other');
    // Same value under both names is not a conflict.
    expect(run({ ...renamed, transaction_id: 'txn_9' }, [rename]).ok).toBe(true);
  });

  it('rejects missing, null and mistyped values deterministically', () => {
    const { payment_reference: _p, ...missing } = renamed;
    expect(codes(run(missing, [rename]))).toEqual(['MISSING_FIELD']);
    expect(codes(run({ ...renamed, payment_reference: null }, [rename]))).toEqual(['NULL_VALUE']);
    expect(codes(run({ ...renamed, payment_reference: 42 }, [rename]))).toEqual(['TYPE_MISMATCH']);
    // keep_null is honoured by the engine but the internal contract still refuses it.
    expect(codes(run({ ...renamed, payment_reference: null }, [rename], { onNull: 'keep_null' }))).toEqual(['CONTRACT_VIOLATION']);
  });

  it('can refuse unexpected extra data when the policy says so', () => {
    const r = run({ ...renamed, surprise: 1 }, [rename], { onExtraFields: 'reject' });
    expect(codes(r)).toEqual(['UNEXPECTED_FIELDS']);
    expect(r.droppedFields).toEqual(['surprise']);
  });
});

describe('rule 2: field_path_mapping', () => {
  const withTotal = { transaction_id: 'txn_1', total: 1250, currency: 'USD', status: 'succeeded', created_at: '2026-10-11T00:00:00.000Z' };

  it('maps external `total` into internal `amount` (the spec example)', () => {
    const r = run(withTotal, [total]);
    expect(r.ok).toBe(true);
    expect((r.output as { amount: number }).amount).toBe(1250);
    expect(r.trace).toContainEqual({ step: 'plan.field_path_mapping', detail: { internalField: 'amount', from: 'total' } });
  });

  it('once mapped, the old external field is no longer consulted', () => {
    // amount is still present but ignored (dropped), total wins; no conflict is raised because the mapping replaced the source.
    const r = run({ ...withTotal, amount: 999 }, [total]);
    expect((r.output as { amount: number }).amount).toBe(1250);
    expect(r.droppedFields).toEqual(['amount']);
  });

  it('rejects strings for integer fields unless numeric strings are explicitly allowed, and never accepts floats', () => {
    expect(codes(run({ ...withTotal, total: '1250' }, [total]))).toEqual(['TYPE_MISMATCH']);
    expect((run({ ...withTotal, total: '1250' }, [total], { allowNumericStrings: true }).output as { amount: number }).amount).toBe(1250);
    expect(codes(run({ ...withTotal, total: 12.5 }, [total], { allowNumericStrings: true }))).toEqual(['TYPE_MISMATCH']);
    expect(codes(run({ ...withTotal, total: true }, [total]))).toEqual(['TYPE_MISMATCH']);
  });

  it('preserves the internal contract: a negative total is a contract violation, not silently accepted', () => {
    const r = run({ ...withTotal, total: -5 }, [total]);
    expect(codes(r)).toEqual(['CONTRACT_VIOLATION']);
    expect(r.rejections[0]!.path).toBe('amount');
    expect(r.contractValid).toBe(false);
  });

  it('supports nested source paths and defaults only when the policy opts in', () => {
    const nested: Transform = { type: 'field_path_mapping', mappings: [{ from: 'money.total', internalField: 'amount', expectedType: 'integer', default: 0 }] };
    expect((run({ ...withTotal, money: { total: 7 } }, [nested]).output as { amount: number }).amount).toBe(7);
    expect(codes(run(withTotal, [nested]))).toEqual(['MISSING_FIELD']);
    expect((run(withTotal, [nested], { onMissing: 'default' }).output as { amount: number }).amount).toBe(0);
  });

  it('rejects two transforms targeting the same internal field as ambiguous', () => {
    const r = run(withTotal, [total, { type: 'field_path_mapping', mappings: [{ from: 'amount', internalField: 'amount', expectedType: 'integer' }] }]);
    expect(codes(r)).toEqual(['AMBIGUOUS_MAPPING']);
  });
});

describe('rule 3: enum_mapping', () => {
  const item = (status: unknown) => ({ shipment_id: 'shp_1', order_id: 'ord_1', carrier: 'UPS', delivery_status: status, estimated_delivery: '2026-10-14' });

  it('maps approved external values and passes identity values through', () => {
    expect((run(item('in_transit'), [enumMap], {}, shipment).output as { deliveryStatus: string }).deliveryStatus).toBe('shipped');
    expect((run(item('delivered'), [enumMap], {}, shipment).output as { deliveryStatus: string }).deliveryStatus).toBe('delivered');
  });

  it('rejects unknown, null and non-string values instead of guessing', () => {
    expect(codes(run(item('lost'), [enumMap], {}, shipment))).toEqual(['UNMAPPED_ENUM_VALUE']);
    expect(codes(run(item(null), [enumMap], {}, shipment))).toEqual(['NULL_VALUE']);
    expect(codes(run(item(3), [enumMap], {}, shipment))).toEqual(['TYPE_MISMATCH']);
    expect(codes(run(item('SHIPPED'), [enumMap], {}, shipment))).toEqual(['UNMAPPED_ENUM_VALUE']); // case-sensitive on purpose
  });

  it('works per item on list endpoints and reports the failing index', () => {
    const r = run({ data: [item('shipped'), item('in_transit'), item('teleported')], page: { number: 1, size: 3, total: 3 } }, [enumMap], {}, shipments);
    expect(r.ok).toBe(false);
    expect(r.rejections).toEqual([{ code: 'UNMAPPED_ENUM_VALUE', path: 'data[2].delivery_status', message: expect.stringContaining('teleported') as unknown }]);
    const ok = run({ data: [item('shipped'), item('in_transit')] }, [enumMap], {}, shipments);
    expect(ok.ok).toBe(true);
    expect((ok.output as Array<{ deliveryStatus: string }>).map((x) => x.deliveryStatus)).toEqual(['shipped', 'shipped']);
  });

  it('refuses a mapping whose target is not an allowed internal value at schema level', () => {
    const bad = transformSchema.safeParse({ type: 'enum_mapping', from: 'delivery_status', internalField: 'deliveryStatus', mapping: { in_transit: 'moving' }, allowedInternalValues: ['pending', 'shipped', 'delivered'] });
    expect(bad.success).toBe(false);
    expect(transformSchema.safeParse({ type: 'enum_mapping', from: 'delivery_status', internalField: 'deliveryStatus', mapping: {}, allowedInternalValues: ['x'] }).success).toBe(false);
  });
});

describe('rule schema and built-in catalogue', () => {
  it('validates every built-in rule and its fixtures behave as declared', () => {
    for (const spec of BUILTIN_REPAIR_RULES) {
      expect(repairRuleSpecSchema.safeParse(spec).success, spec.key).toBe(true);
      const adapter = spec.scope.adapterKey === 'adapter:PaymentsAdapter' ? paymentsAdapter : shippingAdapter;
      const targets = spec.scope.endpointKey === '*' ? Object.values(adapter.endpoints) : [adapter.endpoints[spec.scope.endpointKey]!];
      for (const t of targets) {
        for (const f of spec.fixtures) {
          const payload = t.itemsPath ? { [t.itemsPath]: [f.payload] } : f.payload;
          expect(normalize({ definition: t, payload, transforms: [spec.transform], policy: spec.policy }).ok, `${spec.key}/${f.name}@${t.endpointKey}`).toBe(f.expectOk);
        }
      }
    }
  });

  it('rejects malformed rules: bad keys, mismatched match path, code-like paths, unknown policies', () => {
    const good = BUILTIN_REPAIR_RULES[0]!;
    expect(repairRuleSpecSchema.safeParse({ ...good, key: 'Has Spaces' }).success).toBe(false);
    expect(repairRuleSpecSchema.safeParse({ ...good, match: { ...good.match, path: 'amount' } }).success).toBe(false);
    expect(repairRuleSpecSchema.safeParse({ ...good, transform: { ...good.transform, renamedTo: 'a[0].b' } }).success).toBe(false);
    expect(repairRuleSpecSchema.safeParse({ ...good, transform: { ...good.transform, renamedTo: 'constructor.prototype' } }).success).toBe(true); // just a path; getPath uses own-property checks
    expect(repairRuleSpecSchema.safeParse({ ...good, policy: { ...good.policy, onTypeMismatch: 'coerce' } }).success).toBe(false);
    expect(repairRuleSpecSchema.safeParse({ ...good, transform: { type: 'javascript', code: 'return 1' } }).success).toBe(false);
  });

  it('prototype-looking paths cannot reach inherited properties', () => {
    const t: Transform = { type: 'field_path_mapping', mappings: [{ from: 'constructor.name', internalField: 'paymentId', expectedType: 'string' }] };
    expect(codes(run(base, [t]))).toEqual(['MISSING_FIELD']);
  });
});
