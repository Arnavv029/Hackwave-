import type { Criticality, Severity } from '../generated/prisma/client.js';
import type { EdgeProvenanceValue, EdgeRelationValue, NodeKindValue, TraversalLimits } from './schemas.js';

/**
 * Pure breadth-first impact traversal over an in-memory snapshot of the
 * graph. Edges are upstream -> downstream, so dependents are reached by
 * following OUTGOING edges from the changed node.
 *
 * The result identifies POTENTIAL impact. Reachability is evidence that a
 * component may be affected, not proof that it is broken.
 */

export interface GraphNodeSnapshot {
  id: string;
  key: string;
  kind: NodeKindValue;
  name: string;
  enabled: boolean;
  criticality: Criticality;
}

export interface GraphEdgeSnapshot {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelationValue;
  provenance: EdgeProvenanceValue;
  confidence: number;
  consumedFields: string[];
  note: string | null;
}

export interface GraphSnapshot {
  nodes: GraphNodeSnapshot[];
  edges: GraphEdgeSnapshot[];
}

export interface ChangeContext {
  /** Changed response field path (structural findings); undefined for status/latency/rate changes. */
  changedPath?: string;
  severity: Severity;
  /** Short label of the kind of change, e.g. `structural.field_removed`. */
  rule: string;
}

export type Likelihood = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PathStep {
  edgeId: string;
  relation: EdgeRelationValue;
  provenance: EdgeProvenanceValue;
  confidence: number;
  /** Whether the edge declares consumption of the changed field: true/false, or null when unknown / not applicable. */
  consumesChangedField: boolean | null;
}

export interface ImpactPath {
  /** Node ids from the changed node to the dependent (inclusive). */
  nodeIds: string[];
  nodeKeys: string[];
  steps: PathStep[];
  /** Product of edge confidences × provenance weights. */
  confidence: number;
}

export interface Dependent {
  node: GraphNodeSnapshot;
  /** Shortest depth at which the node was reached (1 = direct). */
  depth: number;
  direct: boolean;
  /** Total number of distinct paths found (bounded by limits). */
  pathCount: number;
  paths: ImpactPath[];
  /** Best (max) path confidence. */
  pathConfidence: number;
  /** Lowest-provenance edge on the best path: OBSERVED > MANUAL > INFERRED. */
  weakestProvenance: EdgeProvenanceValue;
  /** 0..1 ranking score. */
  score: number;
  likelihood: Likelihood;
  evidence: string[];
  /** Why the score is what it is, as numbers. */
  factors: { severity: number; depth: number; path: number; field: number; criticality: number };
}

export interface TraversalStats {
  limits: TraversalLimits;
  visitedNodes: number;
  edgesFollowed: number;
  pathsRecorded: number;
  duplicatePaths: number;
  cyclesDetected: number;
  maxDepthReached: number;
  truncated: boolean;
  truncationReasons: string[];
}

export interface TraversalResult {
  origin: GraphNodeSnapshot;
  dependents: Dependent[];
  stats: TraversalStats;
}

const PROVENANCE_WEIGHT: Record<EdgeProvenanceValue, number> = { OBSERVED: 1, MANUAL: 0.85, INFERRED: 0.55 };
const PROVENANCE_RANK: Record<EdgeProvenanceValue, number> = { OBSERVED: 3, MANUAL: 2, INFERRED: 1 };
const SEVERITY_WEIGHT: Record<Severity, number> = { LOW: 0.4, MEDIUM: 0.65, HIGH: 0.85, CRITICAL: 1 };
const CRITICALITY_BONUS: Record<Criticality, number> = { LOW: 0.9, MEDIUM: 1, HIGH: 1.1, CRITICAL: 1.2 };
const DEPTH_DECAY = 0.85;

export function traverseImpact(graph: GraphSnapshot, originId: string, change: ChangeContext, limits: TraversalLimits): TraversalResult {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const origin = nodes.get(originId);
  if (!origin) throw new Error(`origin node ${originId} not in graph`);
  const outgoing = new Map<string, GraphEdgeSnapshot[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.sourceId) ?? [];
    list.push(e);
    outgoing.set(e.sourceId, list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.targetId.localeCompare(b.targetId) || a.relation.localeCompare(b.relation));

  const stats: TraversalStats = {
    limits,
    visitedNodes: 0,
    edgesFollowed: 0,
    pathsRecorded: 0,
    duplicatePaths: 0,
    cyclesDetected: 0,
    maxDepthReached: 0,
    truncated: false,
    truncationReasons: [],
  };
  const truncate = (reason: string): void => {
    stats.truncated = true;
    if (!stats.truncationReasons.includes(reason)) stats.truncationReasons.push(reason);
  };

  interface Frame {
    nodeId: string;
    depth: number;
    path: ImpactPath;
  }
  const dependents = new Map<string, Dependent>();
  const queue: Frame[] = [{ nodeId: originId, depth: 0, path: { nodeIds: [originId], nodeKeys: [origin.key], steps: [], confidence: 1 } }];
  let head = 0;

  while (head < queue.length) {
    const frame = queue[head] as Frame;
    head += 1;
    if (frame.depth >= limits.maxDepth) {
      if ((outgoing.get(frame.nodeId) ?? []).length > 0) truncate('maxDepth');
      continue;
    }
    for (const edge of outgoing.get(frame.nodeId) ?? []) {
      const target = nodes.get(edge.targetId);
      if (!target) continue;
      // Cycle: the target is already on this path. Record and do not extend.
      if (frame.path.nodeIds.includes(edge.targetId)) {
        stats.cyclesDetected += 1;
        continue;
      }
      stats.edgesFollowed += 1;
      const step: PathStep = {
        edgeId: edge.id,
        relation: edge.relation,
        provenance: edge.provenance,
        confidence: edge.confidence,
        consumesChangedField: fieldConsumption(edge, change, frame.depth === 0),
      };
      const path: ImpactPath = {
        nodeIds: [...frame.path.nodeIds, edge.targetId],
        nodeKeys: [...frame.path.nodeKeys, target.key],
        steps: [...frame.path.steps, step],
        confidence: round(frame.path.confidence * edge.confidence * PROVENANCE_WEIGHT[edge.provenance]),
      };
      const depth = frame.depth + 1;
      const existing = dependents.get(edge.targetId);
      if (existing) {
        stats.duplicatePaths += 1;
        existing.pathCount += 1;
        if (existing.paths.length < limits.maxPathsPerNode && stats.pathsRecorded < limits.maxPaths) {
          existing.paths.push(path);
          stats.pathsRecorded += 1;
        } else {
          truncate(existing.paths.length >= limits.maxPathsPerNode ? 'maxPathsPerNode' : 'maxPaths');
        }
        // Already expanded from its first discovery (BFS: shortest depth first).
        continue;
      }
      if (dependents.size >= limits.maxNodes) {
        truncate('maxNodes');
        continue;
      }
      if (stats.pathsRecorded >= limits.maxPaths) {
        truncate('maxPaths');
        continue;
      }
      stats.pathsRecorded += 1;
      stats.maxDepthReached = Math.max(stats.maxDepthReached, depth);
      dependents.set(edge.targetId, {
        node: target,
        depth,
        direct: depth === 1,
        pathCount: 1,
        paths: [path],
        pathConfidence: 0,
        weakestProvenance: 'OBSERVED',
        score: 0,
        likelihood: 'LOW',
        evidence: [],
        factors: { severity: 0, depth: 0, path: 0, field: 0, criticality: 0 },
      });
      queue.push({ nodeId: edge.targetId, depth, path });
    }
  }
  stats.visitedNodes = dependents.size + 1;

  const ranked = [...dependents.values()].map((d) => rank(d, change));
  ranked.sort((a, b) => b.score - a.score || a.depth - b.depth || a.node.key.localeCompare(b.node.key));
  return { origin, dependents: ranked, stats };
}

/** Does this edge tell us whether the changed field is consumed? */
function fieldConsumption(edge: GraphEdgeSnapshot, change: ChangeContext, firstHop: boolean): boolean | null {
  if (!change.changedPath || !firstHop) return null;
  if (edge.consumedFields.length === 0) return null;
  return edge.consumedFields.some((f) => fieldMatches(f, change.changedPath as string));
}

/** `data[].delivery_status` matches `data[].delivery_status` and `data.delivery_status`; a parent path matches its children. */
export function fieldMatches(declared: string, changed: string): boolean {
  const norm = (p: string): string => p.replace(/\[\]/g, '');
  const a = norm(declared);
  const b = norm(changed);
  return a === b || b.startsWith(`${a}.`) || a.startsWith(`${b}.`);
}

function rank(d: Dependent, change: ChangeContext): Dependent {
  const best = d.paths.reduce((acc, p) => (p.confidence > acc.confidence ? p : acc), d.paths[0] as ImpactPath);
  const weakest = best.steps.reduce<EdgeProvenanceValue>((w, s) => (PROVENANCE_RANK[s.provenance] < PROVENANCE_RANK[w] ? s.provenance : w), 'OBSERVED');
  const evidence: string[] = [];

  const severity = SEVERITY_WEIGHT[change.severity];
  const depth = Math.pow(DEPTH_DECAY, d.depth - 1);
  const path = best.confidence;
  const criticality = CRITICALITY_BONUS[d.node.criticality];

  let field = 1;
  const firstStep = best.steps[0];
  if (change.changedPath) {
    // Field evidence lives on the first hop (operation -> adapter/service). All
    // deeper dependents inherit it through that hop.
    const firstHops = d.paths.map((p) => p.steps[0]?.consumesChangedField ?? null);
    if (firstHops.some((v) => v === true)) {
      field = 1.25;
      evidence.push(`an upstream edge declares consumption of \`${change.changedPath}\` (confirmed field use)`);
    } else if (firstHops.every((v) => v === false)) {
      field = 0.35;
      evidence.push(`the consuming edge lists fields but not \`${change.changedPath}\` (field apparently not used)`);
    } else {
      field = 0.8;
      evidence.push(`no field-level information on the consuming edge; impact of \`${change.changedPath}\` is unknown`);
    }
  } else {
    evidence.push(`${change.rule} affects every caller regardless of fields`);
  }

  evidence.push(d.direct ? `direct dependent via ${firstStep?.relation ?? '?'}` : `indirect dependent at depth ${d.depth} via ${best.steps.map((s) => s.relation).join(' > ')}`);
  if (d.pathCount > 1) evidence.push(`reachable through ${d.pathCount} distinct paths (shared dependency)`);
  if (weakest === 'INFERRED') evidence.push('at least one edge on the best path is INFERRED and unconfirmed');
  else if (weakest === 'MANUAL') evidence.push('path relies on manually registered edges');
  else evidence.push('all edges on the best path were observed');
  if (d.node.criticality === 'CRITICAL' || d.node.criticality === 'HIGH') evidence.push(`node criticality is ${d.node.criticality}`);
  if (!d.node.enabled) evidence.push('node is disabled; impact is theoretical');

  const raw = severity * depth * path * field * criticality * (d.node.enabled ? 1 : 0.5);
  const score = round(Math.min(1, raw));
  const likelihood: Likelihood = score >= 0.55 ? 'HIGH' : score >= 0.3 ? 'MEDIUM' : 'LOW';
  return { ...d, pathConfidence: path, weakestProvenance: weakest, score, likelihood, evidence, factors: { severity, depth: round(depth), path, field, criticality } };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
