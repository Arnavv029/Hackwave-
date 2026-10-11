import type { FindingRecord } from '../detection/stores.js';
import { findAdapterEndpoint } from './adapters.js';
import type { RepairRuleSpec } from './schemas.js';

/**
 * Deterministic matching of a finding to registered rules. A rule matches
 * when provider, endpoint, finding rule and the named field agree. Matches
 * are scored by specificity; the caller only proceeds when one rule is
 * strictly the most specific — ties are ambiguous and are not guessed.
 */

export interface RuleCandidate {
  rule: RepairRuleSpec;
  version: number;
  /** Higher is more specific. */
  specificity: number;
  reasons: string[];
}

export interface FindingChange {
  path: string | null;
  renamedTo: string | null;
  /** New enum values the finding reported. */
  values: string[];
}

export function changeFromFinding(f: FindingRecord): FindingChange {
  const ev = f.evidence;
  const strip = (p: unknown): string | null => (typeof p === 'string' ? p.replace(/\[\]/g, '') : null);
  const path = strip(ev['path']) ?? strip(ev['from']);
  const renamedTo = f.rule === 'structural.rename_candidate' ? strip(ev['to']) : null;
  const after = ev['after'];
  const values = Array.isArray(after) ? after.filter((v): v is string => typeof v === 'string') : [];
  return { path, renamedTo, values };
}

export function matchRules(finding: FindingRecord, rules: Array<{ spec: RepairRuleSpec; version: number }>): RuleCandidate[] {
  const change = changeFromFinding(finding);
  const out: RuleCandidate[] = [];
  for (const { spec, version } of rules) {
    const reasons: string[] = [];
    let specificity = 0;
    if (spec.scope.provider !== finding.providerKey) continue;
    reasons.push(`provider ${spec.scope.provider}`);
    if (spec.scope.endpointKey === '*') {
      specificity += 1;
      reasons.push('any endpoint of the provider');
    } else if (spec.scope.endpointKey === finding.endpointKey) {
      specificity += 3;
      reasons.push(`endpoint ${spec.scope.endpointKey}`);
    } else continue;
    if (!spec.match.findingRules.includes(finding.rule)) continue;
    specificity += 2;
    reasons.push(`finding rule ${finding.rule}`);
    if (spec.match.path) {
      // List endpoints report item fields under the items array (`data.delivery_status`);
      // rules name the field relative to one item.
      const itemsPath = findAdapterEndpoint(spec.scope.adapterKey, finding.endpointKey)?.itemsPath;
      const relative = itemsPath && change.path?.startsWith(`${itemsPath}.`) ? change.path.slice(itemsPath.length + 1) : change.path;
      if (relative !== spec.match.path) continue;
      specificity += 4;
      reasons.push(`path ${spec.match.path}${relative !== change.path ? ` (items of ${itemsPath})` : ''}`);
    }
    if (spec.match.renamedTo) {
      // A rename candidate must name the same new path; a plain removal cannot
      // confirm it, so it matches with lower specificity.
      if (change.renamedTo && change.renamedTo !== spec.match.renamedTo) continue;
      if (change.renamedTo) {
        specificity += 4;
        reasons.push(`renamed to ${spec.match.renamedTo}`);
      } else {
        reasons.push(`new path ${spec.match.renamedTo} not confirmed by the finding`);
      }
    }
    if (spec.match.values && spec.match.values.length) {
      const covered = change.values.filter((v) => spec.match.values?.includes(v));
      if (change.values.length === 0 || covered.length !== change.values.length) {
        if (covered.length === 0) continue;
        reasons.push(`covers only ${covered.join(', ')} of ${change.values.join(', ')}`);
        specificity += 1;
      } else {
        specificity += 3;
        reasons.push(`values ${covered.join(', ')}`);
      }
    }
    out.push({ rule: spec, version, specificity, reasons });
  }
  return out.sort((a, b) => b.specificity - a.specificity || a.rule.key.localeCompare(b.rule.key) || b.version - a.version);
}

export interface Selection {
  selected: RuleCandidate | null;
  candidates: RuleCandidate[];
  reason: string;
}

/** Pick the single most specific candidate; refuse on ties. */
export function selectRule(candidates: RuleCandidate[]): Selection {
  if (candidates.length === 0) return { selected: null, candidates, reason: 'no approved rule matches this finding' };
  const [best, second] = candidates;
  if (best && second && best.specificity === second.specificity && best.rule.key !== second.rule.key) {
    return { selected: null, candidates, reason: `ambiguous: ${candidates.filter((c) => c.specificity === best.specificity).map((c) => c.rule.key).join(', ')} match with equal specificity` };
  }
  return { selected: best ?? null, candidates, reason: `selected ${best?.rule.key} v${best?.version} (specificity ${best?.specificity})` };
}
