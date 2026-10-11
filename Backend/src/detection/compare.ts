import type { BaselineSummary, FieldStats } from './summary.js';

/**
 * Before/after report between two baseline summaries (e.g. version 1 vs 2).
 * Purely descriptive: it lists what differs and by how much.
 */
export interface BaselineComparison {
  before: { version: number; id: string; sampleCount: number; window: BaselineSummary['window'] };
  after: { version: number; id: string; sampleCount: number; window: BaselineSummary['window'] };
  fields: {
    added: Array<{ path: string; after: FieldStats }>;
    removed: Array<{ path: string; before: FieldStats }>;
    typeChanged: Array<{ path: string; before: string[]; after: string[] }>;
    nullabilityChanged: Array<{ path: string; before: number; after: number }>;
    presenceChanged: Array<{ path: string; before: number; after: number }>;
    valuesChanged: Array<{ path: string; added: string[]; removed: string[] }>;
  };
  statusCodes: { added: string[]; removed: string[]; before: Record<string, number>; after: Record<string, number> };
  rates: Record<string, { before: number; after: number; delta: number }>;
  latency: { before: BaselineSummary['latency']; after: BaselineSummary['latency']; p95Delta: number | null };
}

export function compareSummaries(
  a: { id: string; version: number; summary: BaselineSummary },
  b: { id: string; version: number; summary: BaselineSummary },
): BaselineComparison {
  const A = a.summary;
  const B = b.summary;
  const fields: BaselineComparison['fields'] = { added: [], removed: [], typeChanged: [], nullabilityChanged: [], presenceChanged: [], valuesChanged: [] };
  const paths = new Set([...Object.keys(A.fields), ...Object.keys(B.fields)]);
  for (const path of [...paths].sort()) {
    const fa = A.fields[path];
    const fb = B.fields[path];
    if (fa && !fb) fields.removed.push({ path, before: fa });
    else if (!fa && fb) fields.added.push({ path, after: fb });
    else if (fa && fb) {
      if (fa.types.join('|') !== fb.types.join('|')) fields.typeChanged.push({ path, before: fa.types, after: fb.types });
      if ((fa.nullRate === 0) !== (fb.nullRate === 0)) fields.nullabilityChanged.push({ path, before: fa.nullRate, after: fb.nullRate });
      if (Math.abs(fa.presence - fb.presence) >= 0.05) fields.presenceChanged.push({ path, before: fa.presence, after: fb.presence });
      if (fa.values || fb.values) {
        const va = Object.keys(fa.values ?? {});
        const vb = Object.keys(fb.values ?? {});
        const added = vb.filter((v) => !va.includes(v));
        const removed = va.filter((v) => !vb.includes(v));
        if (added.length || removed.length) fields.valuesChanged.push({ path, added, removed });
      }
    }
  }
  const rates: BaselineComparison['rates'] = {};
  for (const k of Object.keys(A.rates) as Array<keyof BaselineSummary['rates']>) {
    rates[k] = { before: A.rates[k], after: B.rates[k], delta: Math.round((B.rates[k] - A.rates[k]) * 1000) / 1000 };
  }
  return {
    before: { version: a.version, id: a.id, sampleCount: A.sampleCount, window: A.window },
    after: { version: b.version, id: b.id, sampleCount: B.sampleCount, window: B.window },
    fields,
    statusCodes: {
      added: Object.keys(B.statusCodes).filter((s) => !A.statusCodes[s]),
      removed: Object.keys(A.statusCodes).filter((s) => !B.statusCodes[s]),
      before: A.statusCodes,
      after: B.statusCodes,
    },
    rates,
    latency: { before: A.latency, after: B.latency, p95Delta: A.latency && B.latency ? B.latency.p95 - A.latency.p95 : null },
  };
}
