import type { InternalContractName } from '../repair/adapters.js';

/**
 * Regression harnesses keyed by graph TEST node key. A harness is a set of
 * invariants over the *internal* record a candidate adapter produces; the
 * pipeline supplies the payload corpus (recent observations + rule fixtures)
 * and the candidate configuration. Harnesses never call providers.
 */

export interface Invariant {
  name: string;
  check: (record: Record<string, unknown>) => true | string;
}

export interface RegressionHarness {
  key: string;
  description: string;
  contract: InternalContractName;
  invariants: Invariant[];
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const paymentIdPresent: Invariant = { name: 'paymentId present', check: (r) => (str(r['paymentId']) ? true : 'paymentId missing or empty') };
const amountPositive: Invariant = { name: 'amount > 0', check: (r) => (typeof r['amount'] === 'number' && r['amount'] > 0 ? true : `amount is ${String(r['amount'])}`) };
const amountInteger: Invariant = { name: 'amount integer >= 0', check: (r) => (Number.isInteger(r['amount']) && (r['amount'] as number) >= 0 ? true : `amount is ${String(r['amount'])}`) };
const currencyIso: Invariant = { name: 'currency ISO-4217', check: (r) => (str(r['currency']) && /^[A-Z]{3}$/.test(r['currency']) ? true : `currency is ${String(r['currency'])}`) };
const statusKnown: Invariant = { name: 'status known', check: (r) => (['succeeded', 'pending', 'failed'].includes(String(r['status'])) ? true : `status is ${String(r['status'])}`) };
const statusSettled: Invariant = { name: 'status succeeded|pending', check: (r) => (['succeeded', 'pending'].includes(String(r['status'])) ? true : `status is ${String(r['status'])}`) };
const createdAtIso: Invariant = { name: 'createdAt parseable', check: (r) => (str(r['createdAt']) && !Number.isNaN(Date.parse(r['createdAt'])) ? true : 'createdAt not a datetime') };

const shipmentIdPresent: Invariant = { name: 'shipmentId present', check: (r) => (str(r['shipmentId']) ? true : 'shipmentId missing') };
const deliveryStatusKnown: Invariant = { name: 'deliveryStatus known', check: (r) => (['pending', 'shipped', 'delivered'].includes(String(r['deliveryStatus'])) ? true : `deliveryStatus is ${String(r['deliveryStatus'])}`) };
const etaDate: Invariant = { name: 'estimatedDelivery is a date', check: (r) => (str(r['estimatedDelivery']) && /^\d{4}-\d{2}-\d{2}$/.test(r['estimatedDelivery']) ? true : 'estimatedDelivery not YYYY-MM-DD') };

export const REGRESSION_HARNESSES: Record<string, RegressionHarness> = {
  'test:checkout-regression': { key: 'test:checkout-regression', description: 'Checkout needs a positive charge with a usable id, currency and settled status.', contract: 'Payment', invariants: [paymentIdPresent, amountPositive, currencyIso, statusSettled, createdAtIso] },
  'test:refund-regression': { key: 'test:refund-regression', description: 'Refund needs the original payment id and a known status.', contract: 'Payment', invariants: [paymentIdPresent, statusKnown] },
  'test:payments-adapter-contract': { key: 'test:payments-adapter-contract', description: 'Every corpus payload must normalise into the Payment contract.', contract: 'Payment', invariants: [paymentIdPresent, amountInteger, currencyIso, statusKnown, createdAtIso] },
  'test:finance-report-smoke': { key: 'test:finance-report-smoke', description: 'Reporting sums amounts per currency.', contract: 'Payment', invariants: [amountInteger, currencyIso] },
  'test:order-tracking-regression': { key: 'test:order-tracking-regression', description: 'Order tracking switches on deliveryStatus and shows the ETA.', contract: 'Shipment', invariants: [shipmentIdPresent, deliveryStatusKnown, etaDate] },
};

/** Unknown TEST nodes fall back to "every payload normalises into the contract". */
export function harnessFor(testKey: string, contract: InternalContractName): RegressionHarness & { generic: boolean } {
  const h = REGRESSION_HARNESSES[testKey];
  if (h && h.contract === contract) return { ...h, generic: false };
  return { key: testKey, description: 'No dedicated harness registered; contract conformance only.', contract, invariants: [], generic: true };
}
