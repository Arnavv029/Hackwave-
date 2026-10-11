import { describe, expect, it } from 'vitest';
import { fieldMatches, traverseImpact, type ChangeContext, type GraphEdgeSnapshot, type GraphNodeSnapshot, type GraphSnapshot } from '../../src/graph/traversal.js';
import { traversalLimitsSchema, type EdgeProvenanceValue, type EdgeRelationValue, type NodeKindValue } from '../../src/graph/schemas.js';

/** Tiny graph DSL: nodes by key, edges as "a -REL-> b" with optional options. */
function graph(nodeDefs: Array<[string, NodeKindValue, Partial<GraphNodeSnapshot>?]>, edgeDefs: Array<[string, EdgeRelationValue, string, Partial<GraphEdgeSnapshot>?]>): GraphSnapshot {
  const nodes: GraphNodeSnapshot[] = nodeDefs.map(([key, kind, extra]) => ({ id: `id:${key}`, key, kind, name: key, enabled: true, criticality: 'MEDIUM', ...extra }));
  const edges: GraphEdgeSnapshot[] = edgeDefs.map(([from, relation, to, extra], i) => ({
    id: `e${i}`,
    sourceId: `id:${from}`,
    targetId: `id:${to}`,
    relation,
    provenance: 'MANUAL',
    confidence: 1,
    consumedFields: [],
    note: null,
    ...extra,
  }));
  return { nodes, edges };
}
const limits = traversalLimitsSchema.parse({});
const change: ChangeContext = { severity: 'HIGH', rule: 'structural.field_removed', changedPath: 'transaction_id' };
const keys = (r: ReturnType<typeof traverseImpact>) => r.dependents.map((d) => d.node.key);

describe('traverseImpact', () => {
  it('finds multi-level dependents in BFS order with depth, paths and edge types', () => {
    const g = graph(
      [['op', 'OPERATION'], ['adapter', 'ADAPTER'], ['svc', 'SERVICE'], ['wf', 'WORKFLOW'], ['test', 'TEST']],
      [['op', 'NORMALIZES', 'adapter', { consumedFields: ['transaction_id'] }], ['adapter', 'USES', 'svc'], ['svc', 'FEEDS_INTO', 'wf'], ['wf', 'COVERED_BY', 'test']],
    );
    const r = traverseImpact(g, 'id:op', change, limits);
    expect(r.origin.key).toBe('op');
    const byKey = Object.fromEntries(r.dependents.map((d) => [d.node.key, d]));
    expect(byKey['adapter']).toMatchObject({ depth: 1, direct: true, pathCount: 1 });
    expect(byKey['wf']).toMatchObject({ depth: 3, direct: false });
    expect(byKey['test']?.depth).toBe(4);
    expect(byKey['wf']?.paths[0]?.nodeKeys).toEqual(['op', 'adapter', 'svc', 'wf']);
    expect(byKey['wf']?.paths[0]?.steps.map((s) => s.relation)).toEqual(['NORMALIZES', 'USES', 'FEEDS_INTO']);
    expect(byKey['wf']?.paths[0]?.steps[0]?.consumesChangedField).toBe(true);
    expect(byKey['wf']?.paths[0]?.steps[1]?.consumesChangedField).toBeNull();
    expect(r.stats).toMatchObject({ visitedNodes: 5, edgesFollowed: 4, pathsRecorded: 4, duplicatePaths: 0, cyclesDetected: 0, maxDepthReached: 4, truncated: false });
    // Ranking decays with depth.
    expect(byKey['adapter']!.score).toBeGreaterThan(byKey['svc']!.score);
    expect(byKey['svc']!.score).toBeGreaterThan(byKey['wf']!.score);
  });

  it('handles branching and shared dependencies (diamond) by counting duplicate paths', () => {
    const g = graph(
      [['op', 'OPERATION'], ['a1', 'ADAPTER'], ['a2', 'ADAPTER'], ['shared', 'SERVICE'], ['wfA', 'WORKFLOW'], ['wfB', 'WORKFLOW']],
      [['op', 'CALLS', 'a1'], ['op', 'CALLS', 'a2'], ['a1', 'USES', 'shared'], ['a2', 'USES', 'shared'], ['shared', 'FEEDS_INTO', 'wfA'], ['a1', 'USES', 'wfB']],
    );
    const r = traverseImpact(g, 'id:op', change, limits);
    const shared = r.dependents.find((d) => d.node.key === 'shared')!;
    expect(shared.pathCount).toBe(2);
    expect(shared.paths.map((p) => p.nodeKeys.join('>'))).toEqual(['op>a1>shared', 'op>a2>shared']);
    expect(shared.evidence).toContain('reachable through 2 distinct paths (shared dependency)');
    expect(r.stats.duplicatePaths).toBe(1);
    // Downstream of the shared node is expanded once, not once per path.
    expect(r.dependents.find((d) => d.node.key === 'wfA')!.pathCount).toBe(1);
    expect(keys(r).sort()).toEqual(['a1', 'a2', 'shared', 'wfA', 'wfB']);
  });

  it('terminates on cycles and records them', () => {
    const g = graph(
      [['op', 'OPERATION'], ['a', 'ADAPTER'], ['s1', 'SERVICE'], ['s2', 'SERVICE'], ['wf', 'WORKFLOW']],
      [['op', 'CALLS', 'a'], ['a', 'USES', 's1'], ['s1', 'FEEDS_INTO', 's2'], ['s2', 'FEEDS_INTO', 's1'], ['s2', 'FEEDS_INTO', 'wf'], ['wf', 'FEEDS_INTO', 'wf']],
    );
    const r = traverseImpact(g, 'id:op', change, limits);
    expect(keys(r).sort()).toEqual(['a', 's1', 's2', 'wf']);
    expect(r.stats.cyclesDetected).toBe(2);
    expect(r.stats.truncated).toBe(false);
    expect(r.dependents.find((d) => d.node.key === 's1')!.pathCount).toBe(1);
  });

  it('reports nothing for disconnected nodes and for an operation with no consumers', () => {
    const g = graph([['op', 'OPERATION'], ['lonely', 'SERVICE'], ['other', 'OPERATION'], ['a', 'ADAPTER']], [['other', 'CALLS', 'a']]);
    const r = traverseImpact(g, 'id:op', change, limits);
    expect(r.dependents).toEqual([]);
    expect(r.stats).toMatchObject({ visitedNodes: 1, edgesFollowed: 0, maxDepthReached: 0 });
    expect(() => traverseImpact(g, 'id:missing', change, limits)).toThrow(/not in graph/);
  });

  it('respects maxDepth, maxNodes and per-node path limits and says so', () => {
    const chain: Array<[string, NodeKindValue]> = [['op', 'OPERATION'], ['a', 'ADAPTER']];
    const edges: Array<[string, EdgeRelationValue, string]> = [['op', 'CALLS', 'a']];
    let prev = 'a';
    for (let i = 0; i < 10; i += 1) {
      chain.push([`s${i}`, 'SERVICE']);
      edges.push([prev, i === 0 ? 'USES' : 'FEEDS_INTO', `s${i}`]);
      prev = `s${i}`;
    }
    const g = graph(chain, edges);
    const shallow = traverseImpact(g, 'id:op', change, { ...limits, maxDepth: 3 });
    expect(shallow.dependents).toHaveLength(3);
    expect(shallow.stats).toMatchObject({ truncated: true, truncationReasons: ['maxDepth'], maxDepthReached: 3 });
    const few = traverseImpact(g, 'id:op', change, { ...limits, maxNodes: 2 });
    expect(few.dependents).toHaveLength(2);
    expect(few.stats.truncationReasons).toEqual(['maxNodes']);

    const fan = graph(
      [['op', 'OPERATION'], ['a1', 'ADAPTER'], ['a2', 'ADAPTER'], ['a3', 'ADAPTER'], ['hub', 'SERVICE']],
      [['op', 'CALLS', 'a1'], ['op', 'CALLS', 'a2'], ['op', 'CALLS', 'a3'], ['a1', 'USES', 'hub'], ['a2', 'USES', 'hub'], ['a3', 'USES', 'hub']],
    );
    const capped = traverseImpact(fan, 'id:op', change, { ...limits, maxPathsPerNode: 2 });
    const hub = capped.dependents.find((d) => d.node.key === 'hub')!;
    expect(hub.pathCount).toBe(3);
    expect(hub.paths).toHaveLength(2);
    expect(capped.stats.truncationReasons).toEqual(['maxPathsPerNode']);
  });

  it('is deterministic: same graph and change give identical output regardless of edge insertion order', () => {
    const forward = graph([['op', 'OPERATION'], ['a', 'ADAPTER'], ['b', 'ADAPTER']], [['op', 'CALLS', 'a'], ['op', 'CALLS', 'b']]);
    const backward = graph([['op', 'OPERATION'], ['a', 'ADAPTER'], ['b', 'ADAPTER']], [['op', 'CALLS', 'b'], ['op', 'CALLS', 'a']]);
    expect(keys(traverseImpact(forward, 'id:op', change, limits))).toEqual(keys(traverseImpact(backward, 'id:op', change, limits)));
  });
});

describe('ranking evidence', () => {
  const base = (consumedFields: string[], provenance: EdgeProvenanceValue = 'MANUAL', confidence = 1) =>
    graph(
      [['op', 'OPERATION'], ['adapter', 'ADAPTER'], ['svc', 'SERVICE', { criticality: 'CRITICAL' }]],
      [['op', 'NORMALIZES', 'adapter', { consumedFields, provenance, confidence }], ['adapter', 'USES', 'svc']],
    );
  const adapter = (g: GraphSnapshot, c = change) => traverseImpact(g, 'id:op', c, limits).dependents.find((d) => d.node.key === 'adapter')!;

  it('ranks confirmed field consumption above unknown above declared non-consumption', () => {
    const confirmed = adapter(base(['transaction_id', 'amount']));
    const unknown = adapter(base([]));
    const notUsed = adapter(base(['amount', 'currency']));
    expect(confirmed.score).toBeGreaterThan(unknown.score);
    expect(unknown.score).toBeGreaterThan(notUsed.score);
    expect(confirmed.likelihood).toBe('HIGH');
    expect(notUsed.likelihood).toBe('LOW');
    expect(confirmed.evidence[0]).toMatch(/confirmed field use/);
    expect(unknown.evidence[0]).toMatch(/unknown/);
    expect(notUsed.evidence[0]).toMatch(/apparently not used/);
    expect(confirmed.factors.field).toBeGreaterThan(unknown.factors.field);
  });

  it('propagates field evidence from the first hop to indirect dependents', () => {
    const svcConfirmed = traverseImpact(base(['transaction_id']), 'id:op', change, limits).dependents.find((d) => d.node.key === 'svc')!;
    const svcNotUsed = traverseImpact(base(['amount']), 'id:op', change, limits).dependents.find((d) => d.node.key === 'svc')!;
    expect(svcConfirmed.score).toBeGreaterThan(svcNotUsed.score);
    expect(svcConfirmed.evidence.some((e) => e.includes('criticality is CRITICAL'))).toBe(true);
  });

  it('treats non-field changes as affecting every caller equally', () => {
    const c: ChangeContext = { severity: 'HIGH', rule: 'behavioral.status_changed' };
    expect(adapter(base(['amount']), c).score).toBe(adapter(base(['transaction_id']), c).score);
    expect(adapter(base([]), c).evidence[0]).toMatch(/affects every caller/);
  });

  it('discounts inferred and low-confidence edges and names the weakest provenance', () => {
    const observed = adapter(base(['transaction_id'], 'OBSERVED'));
    const manual = adapter(base(['transaction_id'], 'MANUAL'));
    const inferred = adapter(base(['transaction_id'], 'INFERRED', 0.5));
    expect(observed.score).toBeGreaterThan(manual.score);
    expect(manual.score).toBeGreaterThan(inferred.score);
    expect(inferred.weakestProvenance).toBe('INFERRED');
    expect(inferred.evidence).toContain('at least one edge on the best path is INFERRED and unconfirmed');
    expect(inferred.pathConfidence).toBeCloseTo(0.275, 3);
  });

  it('scales with finding severity and down-weights disabled nodes', () => {
    const high = adapter(base([]));
    const low = adapter(base([]), { ...change, severity: 'LOW' });
    expect(high.score).toBeGreaterThan(low.score);
    const g = graph([['op', 'OPERATION'], ['adapter', 'ADAPTER', { enabled: false }]], [['op', 'CALLS', 'adapter']]);
    const disabled = traverseImpact(g, 'id:op', change, limits).dependents[0]!;
    expect(disabled.evidence).toContain('node is disabled; impact is theoretical');
    expect(disabled.score).toBeLessThan(high.score);
  });

  it('matches field paths across array markers and parent/child relations', () => {
    expect(fieldMatches('data[].delivery_status', 'data[].delivery_status')).toBe(true);
    expect(fieldMatches('data.delivery_status', 'data[].delivery_status')).toBe(true);
    expect(fieldMatches('page', 'page.total')).toBe(true);
    expect(fieldMatches('page.total', 'page')).toBe(true);
    expect(fieldMatches('amount', 'amount_cents')).toBe(false);
  });
});
