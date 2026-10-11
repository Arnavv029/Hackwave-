import { INTERNAL_CONTRACT_FIELDS, type AdapterEndpointDefinition } from '../repair/adapters.js';
import type { Transform } from '../repair/schemas.js';
import type { AiProposalOutput } from './schemas.js';

/**
 * Backend policy over model output. The model is untrusted: it may have been
 * steered by text inside the provider's response. These checks are
 * independent of whatever it claims about itself.
 */

export interface PolicyIssue {
  code: 'FORBIDDEN_CONTENT' | 'UNSUPPORTED_TRANSFORM' | 'UNKNOWN_INTERNAL_FIELD' | 'INCONSISTENT_TRANSFORM' | 'UNKNOWN_ENUM_TARGET' | 'EMPTY_MAPPING' | 'TYPE_MISMATCH' | 'PATH_SYNTAX';
  path: string;
  message: string;
}

/** Patterns that must never appear in any string the model returns. */
const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'javascript', re: /\b(eval|Function|require|import|process\.env|child_process|exec(?:Sync)?|spawn)\s*\(?/i },
  { name: 'script-tag', re: /<\s*script\b/i },
  { name: 'shell', re: /(\brm\s+-rf\b|\bcurl\b|\bwget\b|\bsudo\b|\|\s*(ba)?sh\b|\$\(|`[^`]*`)/i },
  { name: 'sql', re: /\b(drop\s+table|delete\s+from|insert\s+into|update\s+\w+\s+set|alter\s+table|truncate\s+table|union\s+select)\b/i },
  { name: 'patch', re: /(^|\n)(diff --git|\+\+\+ |--- a\/|@@ -\d)/ },
  { name: 'url', re: /\bhttps?:\/\//i },
  { name: 'instruction', re: /\b(ignore (all|any|the) (previous|prior|above) instructions|you are now|system prompt|developer message)\b/i },
];

/** Dot path of identifiers only; the same grammar the deterministic rules accept. */
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function scanForbiddenContent(value: unknown, path = '$'): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const visit = (v: unknown, p: string): void => {
    if (typeof v === 'string') {
      for (const { name, re } of FORBIDDEN_PATTERNS) {
        if (re.test(v)) issues.push({ code: 'FORBIDDEN_CONTENT', path: p, message: `contains ${name}-like content` });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) visit(x, `${p}.${k}`);
  };
  visit(value, path);
  return issues;
}

export interface CompiledProposal {
  transform: Transform | null;
  issues: PolicyIssue[];
}

/**
 * Turn the model's proposal into a Phase 5 transform, or explain why not.
 * Only the three supported transform types exist; everything else is a
 * policy issue. Internal fields and enum targets must belong to the contract.
 */
export function compileProposal(output: AiProposalOutput, def: AdapterEndpointDefinition): CompiledProposal {
  const issues = scanForbiddenContent(output);
  const contract = INTERNAL_CONTRACT_FIELDS[def.contract];
  const known = new Set(def.baseMapping.map((m) => m.internalField));
  const t = output.transformation;
  const checkPath = (p: string, where: string): boolean => {
    if (!PATH_RE.test(p.replace(/\[\]/g, ''))) {
      issues.push({ code: 'PATH_SYNTAX', path: where, message: `"${p}" is not a plain dot path` });
      return false;
    }
    return true;
  };
  const checkInternal = (field: string, where: string): boolean => {
    if (!known.has(field) || !contract[field]) {
      issues.push({ code: 'UNKNOWN_INTERNAL_FIELD', path: where, message: `"${field}" is not a field of the ${def.contract} contract via ${def.endpointKey}` });
      return false;
    }
    return true;
  };

  let transform: Transform | null = null;
  switch (t.type) {
    case 'none':
      break;
    case 'rename_field': {
      const r = t.rename_field;
      if (!r) {
        issues.push({ code: 'INCONSISTENT_TRANSFORM', path: 'transformation.rename_field', message: 'type is rename_field but details are null' });
        break;
      }
      const from = r.from.replace(/\[\]/g, '');
      const to = r.renamed_to.replace(/\[\]/g, '');
      if (checkPath(from, 'transformation.rename_field.from') && checkPath(to, 'transformation.rename_field.renamed_to') && checkInternal(r.internal_field, 'transformation.rename_field.internal_field')) {
        const expected = contract[r.internal_field]?.type;
        if (expected && expected !== r.expected_type && !(expected === 'integer' && r.expected_type === 'number')) {
          issues.push({ code: 'TYPE_MISMATCH', path: 'transformation.rename_field.expected_type', message: `${r.internal_field} is ${expected} in the contract, proposal says ${r.expected_type}` });
        } else {
          transform = { type: 'rename_field', from, renamedTo: to, internalField: r.internal_field, expectedType: expected ?? r.expected_type };
        }
      }
      break;
    }
    case 'field_path_mapping': {
      const m = t.field_path_mapping;
      if (!m || m.mappings.length === 0) {
        issues.push({ code: 'EMPTY_MAPPING', path: 'transformation.field_path_mapping', message: 'no mappings supplied' });
        break;
      }
      const mappings: Array<{ from: string; internalField: string; expectedType: 'string' | 'number' | 'integer' | 'boolean' }> = [];
      m.mappings.forEach((x, i) => {
        const from = x.from.replace(/\[\]/g, '');
        if (!checkPath(from, `transformation.field_path_mapping.mappings[${i}].from`) || !checkInternal(x.internal_field, `transformation.field_path_mapping.mappings[${i}].internal_field`)) return;
        const expected = contract[x.internal_field]?.type ?? x.expected_type;
        if (expected !== x.expected_type && !(expected === 'integer' && x.expected_type === 'number')) {
          issues.push({ code: 'TYPE_MISMATCH', path: `transformation.field_path_mapping.mappings[${i}].expected_type`, message: `${x.internal_field} is ${expected} in the contract` });
          return;
        }
        mappings.push({ from, internalField: x.internal_field, expectedType: expected });
      });
      if (mappings.length === m.mappings.length && mappings.length > 0) transform = { type: 'field_path_mapping', mappings };
      break;
    }
    case 'enum_mapping': {
      const e = t.enum_mapping;
      if (!e || e.mapping.length === 0) {
        issues.push({ code: 'EMPTY_MAPPING', path: 'transformation.enum_mapping', message: 'no mapping pairs supplied' });
        break;
      }
      const from = e.from.replace(/\[\]/g, '');
      if (!checkPath(from, 'transformation.enum_mapping.from') || !checkInternal(e.internal_field, 'transformation.enum_mapping.internal_field')) break;
      const allowed = contract[e.internal_field]?.enum;
      if (!allowed) {
        issues.push({ code: 'UNKNOWN_ENUM_TARGET', path: 'transformation.enum_mapping.internal_field', message: `${e.internal_field} is not an enum field in the ${def.contract} contract` });
        break;
      }
      const mapping: Record<string, string> = {};
      let ok = true;
      e.mapping.forEach((pair, i) => {
        if (!allowed.includes(pair.internal)) {
          issues.push({ code: 'UNKNOWN_ENUM_TARGET', path: `transformation.enum_mapping.mapping[${i}].internal`, message: `"${pair.internal}" is not one of ${allowed.join(', ')}` });
          ok = false;
        } else if (mapping[pair.external] !== undefined && mapping[pair.external] !== pair.internal) {
          issues.push({ code: 'INCONSISTENT_TRANSFORM', path: `transformation.enum_mapping.mapping[${i}]`, message: `"${pair.external}" is mapped to two different values` });
          ok = false;
        } else mapping[pair.external] = pair.internal;
      });
      // Identity entries for already-valid values keep the adapter working for unchanged payloads.
      for (const v of allowed) mapping[v] ??= v;
      if (ok) transform = { type: 'enum_mapping', from, internalField: e.internal_field, mapping, allowedInternalValues: allowed };
      break;
    }
    default: {
      const never: never = t.type;
      issues.push({ code: 'UNSUPPORTED_TRANSFORM', path: 'transformation.type', message: `unsupported transform ${String(never)}` });
    }
  }
  return { transform: issues.some((i) => i.code === 'FORBIDDEN_CONTENT') ? null : transform, issues };
}

/** Markers that suggest a sample is trying to talk to the model rather than describe a payment. */
const INJECTION_MARKERS: RegExp[] = [
  /ignore (all|any|the) (previous|prior|above) instructions/i,
  /\b(system prompt|developer message|assistant:|human:)\b/i,
  /you are (now|a|an) /i,
  /\b(approve|activate|apply) (this|the) (repair|mapping|change)\b/i,
  /<\/?(instruction|system|prompt)s?>/i,
];

export function detectInjection(value: unknown): string[] {
  const hits = new Set<string>();
  const visit = (v: unknown, p: string): void => {
    if (typeof v === 'string') {
      for (const re of INJECTION_MARKERS) if (re.test(v)) hits.add(`${p}: matches ${re.source.slice(0, 40)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) visit(x, `${p}.${k}`);
  };
  visit(value, 'sample');
  return [...hits].slice(0, 10);
}
