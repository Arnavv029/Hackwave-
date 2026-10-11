import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ImpactReportBody } from '../graph/service.js';
import type { StoredObservation } from '../observation/store.js';
import { getEndpointContract, type ProviderKey } from '../providers/contracts.js';
import { scanForbiddenContent } from '../ai/policy.js';
import { INTERNAL_CONTRACT_FIELDS, type AdapterEndpointDefinition } from '../repair/adapters.js';
import { normalize, type NormalizeResult, type RejectionCode } from '../repair/engine.js';
import { policySchema, transformSchema, type Policy, type Transform } from '../repair/schemas.js';
import type { ProposalRecord, RuleRecord, VersionRecord } from '../repair/stores.js';
import { harnessFor } from './regression.js';

/**
 * The validation pipeline. Pure apart from the inputs it is handed: it never
 * touches stores or providers, so a report is a deterministic function of
 * (candidate spec, corpus, graph selection). The service persists it.
 */

export interface CorpusPayload {
  source: 'OBSERVATION' | 'FIXTURE';
  id: string;
  payload: unknown;
  expectOk: boolean;
}

export interface PipelineInput {
  proposal: ProposalRecord;
  version: VersionRecord;
  endpoint: AdapterEndpointDefinition;
  rule: RuleRecord | null;
  corpus: CorpusPayload[];
  /** Impact from the operation node; tests are selected from it. */
  impact: ImpactReportBody | null;
  /** Latest new-shape sample, used to synthesise negative cases. */
  latestSample: Record<string, unknown> | null;
}

export interface StageResult {
  stage: 'proposal_check' | 'candidate_config' | 'contract_check' | 'replay' | 'regression_tests' | 'negative_tests';
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  mandatory: boolean;
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
}

export interface RegressionTestResult {
  testKey: string;
  covers: string[];
  likelihood: string;
  mandatory: boolean;
  generic: boolean;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  payloads: number;
  failures: Array<{ payloadId: string; invariant: string; detail: string }>;
  durationMs: number;
}

export interface NegativeCase {
  name: string;
  expectedCode: RejectionCode | 'OK';
  actualOk: boolean;
  actualCodes: string[];
  passed: boolean;
}

export interface ReplayExecution {
  source: CorpusPayload['source'];
  id: string;
  inputHash: string;
  outputHash: string | null;
  ok: boolean;
  expectOk: boolean;
  rejections: NormalizeResult['rejections'];
  contractValid: boolean | null;
}

export interface ValidationReport {
  proposalId: string;
  versionId: string;
  version: number;
  checksum: string;
  candidate: { adapterKey: string; endpointKey: string; contract: string; transforms: Transform[]; policy: Policy; checksum: string };
  stages: StageResult[];
  replay: { total: number; passed: number; failed: number; unexpected: number; reproducible: boolean; executions: ReplayExecution[] };
  regressionTests: RegressionTestResult[];
  negativeTests: NegativeCase[];
  contract: { input: { checked: number; conformingToProviderContract: number }; output: { checked: number; valid: number } };
  selection: { fromImpact: boolean; tests: number; mandatory: number; note: string };
  status: 'PASSED' | 'FAILED';
  mandatoryFailures: number;
  totalTests: number;
  reportHash: string;
  generatedAt: string;
}

const specSchema = z.object({ transforms: z.array(transformSchema).min(1).max(5), policy: policySchema }).passthrough();

export function runValidationPipeline(input: PipelineInput): ValidationReport {
  const stages: StageResult[] = [];
  const timed = <T>(fn: () => T): [T, number] => {
    const s = performance.now();
    const r = fn();
    return [r, Math.max(0, Math.round(performance.now() - s))];
  };
  const { proposal, version, endpoint } = input;

  // 1. Proposal and transform type check (data only; nothing executable).
  const [check, d1] = timed(() => {
    const problems: string[] = [];
    if (proposal.kind === 'MANUAL_REVIEW') problems.push('MANUAL_REVIEW proposals carry no transform');
    const parsed = specSchema.safeParse(version.spec);
    if (!parsed.success) problems.push(...parsed.error.issues.map((i) => `spec.${i.path.join('.')}: ${i.message}`));
    const forbidden = scanForbiddenContent(version.spec);
    if (forbidden.length) problems.push(...forbidden.map((f) => `${f.path}: ${f.message}`));
    if (version.spec.adapterKey !== endpoint.endpointKey && version.spec.endpointKey !== endpoint.endpointKey) problems.push('version targets a different endpoint');
    if (proposal.ruleKey && (!input.rule || input.rule.status !== 'APPROVED')) problems.push(`rule ${proposal.ruleKey} v${proposal.ruleVersion ?? '?'} is not APPROVED`);
    const known = new Set(endpoint.baseMapping.map((m) => m.internalField));
    for (const t of version.spec.transforms) {
      const fields = t.type === 'field_path_mapping' ? t.mappings.map((m) => m.internalField) : [t.internalField];
      for (const f of fields) if (!known.has(f)) problems.push(`transform writes unknown internal field ${f}`);
      if (t.type === 'enum_mapping') {
        const allowed = INTERNAL_CONTRACT_FIELDS[endpoint.contract][t.internalField]?.enum ?? [];
        for (const v of Object.values(t.mapping)) if (!allowed.includes(v)) problems.push(`enum target ${v} not allowed for ${t.internalField}`);
      }
    }
    return problems;
  });
  stages.push({ stage: 'proposal_check', status: check.length ? 'FAILED' : 'PASSED', mandatory: true, summary: check.length ? `${check.length} problem(s): ${check.join('; ').slice(0, 300)}` : 'supported transform types, approved rule, contract fields only', details: { problems: check, transformTypes: version.spec.transforms.map((t) => t.type) }, durationMs: d1 });

  // 2. Isolated candidate configuration (never the live pointer).
  const candidate = { adapterKey: version.spec.adapterKey, endpointKey: version.spec.endpointKey, contract: endpoint.contract, transforms: structuredClone(version.spec.transforms), policy: structuredClone(version.spec.policy), checksum: version.checksum };
  const run = (payload: unknown): NormalizeResult => normalize({ definition: endpoint, payload, transforms: candidate.transforms, policy: candidate.policy });
  stages.push({ stage: 'candidate_config', status: 'PASSED', mandatory: true, summary: `candidate ${candidate.checksum.slice(0, 12)} built in isolation`, details: { adapterKey: candidate.adapterKey, endpointKey: candidate.endpointKey, transforms: candidate.transforms.length }, durationMs: 0 });

  const abort = check.length > 0;

  // 3. Replay corpus (input contract informational, output contract mandatory).
  const [replay, d3] = timed(() => {
    const executions: ReplayExecution[] = [];
    const seen = new Map<string, string | null>();
    let reproducible = true;
    let inputConforming = 0;
    const providerSchema = getEndpointContract(proposal.adapterKey ? (proposalProvider(endpoint) as ProviderKey) : 'payments', endpointNameFor(endpoint))?.response;
    for (const c of input.corpus) {
      const first = run(c.payload);
      const second = run(c.payload);
      if (first.ok !== second.ok || first.outputHash !== second.outputHash) reproducible = false;
      const prior = seen.get(first.inputHash);
      if (prior !== undefined && prior !== first.outputHash) reproducible = false;
      seen.set(first.inputHash, first.outputHash);
      if (providerSchema?.safeParse(c.payload).success) inputConforming += 1;
      executions.push({ source: c.source, id: c.id, inputHash: first.inputHash, outputHash: first.outputHash, ok: first.ok, expectOk: c.expectOk, rejections: first.rejections.slice(0, 5), contractValid: first.contractValid });
    }
    const passed = executions.filter((e) => e.ok).length;
    const unexpected = executions.filter((e) => e.ok !== e.expectOk).length;
    return { total: executions.length, passed, failed: executions.length - passed, unexpected, reproducible, executions, inputConforming };
  });
  const replayFailed = abort || replay.total === 0 || replay.unexpected > 0 || !replay.reproducible;
  stages.push({ stage: 'contract_check', status: abort ? 'SKIPPED' : replay.executions.some((e) => e.expectOk && e.contractValid === false) ? 'FAILED' : 'PASSED', mandatory: true, summary: `input: ${replay.inputConforming}/${replay.total} payloads match the declared provider contract (informational); output: internal contract enforced on every normalisation`, details: { inputConforming: replay.inputConforming, outputValid: replay.executions.filter((e) => e.contractValid === true).length }, durationMs: 0 });
  stages.push({ stage: 'replay', status: abort ? 'SKIPPED' : replayFailed ? 'FAILED' : 'PASSED', mandatory: true, summary: replay.total === 0 ? 'nothing to replay' : `${replay.passed}/${replay.total} normalised, ${replay.unexpected} unexpected, reproducible=${String(replay.reproducible)}`, details: { total: replay.total, unexpected: replay.unexpected, reproducible: replay.reproducible }, durationMs: d3 });

  // 4. Regression tests selected through the dependency graph.
  const okCorpus = input.corpus.filter((c) => c.expectOk);
  const [tests, d4] = timed(() => {
    const out: RegressionTestResult[] = [];
    const selected = input.impact?.tests ?? [];
    for (const t of selected) {
      const s = performance.now();
      const harness = harnessFor(t.node.key, endpoint.contract);
      const mandatory = t.likelihood === 'HIGH' || t.likelihood === 'MEDIUM';
      const failures: RegressionTestResult['failures'] = [];
      if (!abort) {
        for (const c of okCorpus) {
          const r = run(c.payload);
          if (!r.ok) {
            failures.push({ payloadId: c.id, invariant: 'normalises into the contract', detail: r.rejections.map((x) => x.code).join(',') || 'rejected' });
            continue;
          }
          const records = Array.isArray(r.output) ? (r.output as Array<Record<string, unknown>>) : [r.output as Record<string, unknown>];
          for (const rec of records) for (const inv of harness.invariants) {
            const res = inv.check(rec);
            if (res !== true) failures.push({ payloadId: c.id, invariant: inv.name, detail: res });
          }
        }
      }
      out.push({ testKey: t.node.key, covers: t.covers, likelihood: t.likelihood, mandatory, generic: harness.generic, status: abort ? 'SKIPPED' : failures.length ? 'FAILED' : 'PASSED', payloads: okCorpus.length, failures: failures.slice(0, 20), durationMs: Math.max(0, Math.round(performance.now() - s)) });
    }
    return out;
  });
  const mandatoryTestFailures = tests.filter((t) => t.mandatory && t.status === 'FAILED').length;
  stages.push({ stage: 'regression_tests', status: abort ? 'SKIPPED' : tests.length === 0 ? 'SKIPPED' : mandatoryTestFailures || tests.some((t) => t.status === 'FAILED') ? 'FAILED' : 'PASSED', mandatory: true, summary: tests.length === 0 ? 'no tests reachable from the changed operation in the dependency graph' : `${tests.filter((t) => t.status === 'PASSED').length}/${tests.length} passed (${tests.filter((t) => t.mandatory).length} mandatory)`, details: { selected: tests.map((t) => t.testKey) }, durationMs: d4 });

  // 5. Negative and edge cases synthesised from the candidate.
  const [negative, d5] = timed(() => (abort || !input.latestSample ? [] : negativeCases(candidate.transforms, input.latestSample, endpoint, run)));
  const negativeFailures = negative.filter((n) => !n.passed).length;
  stages.push({ stage: 'negative_tests', status: abort ? 'SKIPPED' : negative.length === 0 ? 'SKIPPED' : negativeFailures ? 'FAILED' : 'PASSED', mandatory: true, summary: negative.length === 0 ? 'no sample to derive cases from' : `${negative.length - negativeFailures}/${negative.length} edge cases behaved as required`, details: { failures: negative.filter((n) => !n.passed).map((n) => n.name) }, durationMs: d5 });

  const mandatoryFailures = stages.filter((s) => s.mandatory && s.status === 'FAILED').length + mandatoryTestFailures;
  const status: ValidationReport['status'] = mandatoryFailures === 0 && !abort ? 'PASSED' : 'FAILED';
  const body = {
    proposalId: proposal.id,
    versionId: version.id,
    version: version.version,
    checksum: version.checksum,
    candidate,
    stages,
    replay: { total: replay.total, passed: replay.passed, failed: replay.failed, unexpected: replay.unexpected, reproducible: replay.reproducible, executions: replay.executions },
    regressionTests: tests,
    negativeTests: negative,
    contract: { input: { checked: replay.total, conformingToProviderContract: replay.inputConforming }, output: { checked: replay.total, valid: replay.executions.filter((e) => e.contractValid === true).length } },
    selection: { fromImpact: input.impact !== null, tests: tests.length, mandatory: tests.filter((t) => t.mandatory).length, note: input.impact ? `tests reached from ${input.impact.changedDependency.operation.key} via COVERED_BY edges` : 'no impact report: no graph-selected tests' },
    status,
    mandatoryFailures,
    totalTests: tests.length + negative.length + replay.total,
  };
  const reportHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return { ...body, reportHash, generatedAt: new Date().toISOString() };
}

function proposalProvider(endpoint: AdapterEndpointDefinition): string {
  return endpoint.contract === 'Payment' ? 'payments' : 'shipping';
}
function endpointNameFor(endpoint: AdapterEndpointDefinition): string {
  return endpoint.verification.endpointName;
}

/** Mutations of the latest sample that a safe adapter must reject (or, for extra fields, tolerate). */
export function negativeCases(transforms: Transform[], sample: Record<string, unknown>, endpoint: AdapterEndpointDefinition, run: (p: unknown) => NormalizeResult): NegativeCase[] {
  const cases: Array<{ name: string; payload: unknown; expected: RejectionCode | 'OK' }> = [];
  const items = endpoint.itemsPath ? (sample[endpoint.itemsPath] as unknown[] | undefined) : undefined;
  const base: Record<string, unknown> = endpoint.itemsPath ? ((Array.isArray(items) && isRecord(items[0]) ? items[0] : {})) : sample;
  const wrap = (item: Record<string, unknown>): unknown => (endpoint.itemsPath ? { ...sample, [endpoint.itemsPath]: [item] } : item);
  const without = (obj: Record<string, unknown>, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

  for (const t of transforms) {
    const sources = t.type === 'rename_field' ? [{ path: t.renamedTo, type: t.expectedType }] : t.type === 'field_path_mapping' ? t.mappings.map((m) => ({ path: m.from, type: m.expectedType })) : [{ path: t.from, type: 'string' as const }];
    for (const s of sources) {
      const top = s.path.split('.')[0] as string;
      if (!(top in base)) continue;
      cases.push({ name: `missing ${s.path}`, payload: wrap(without(base, top)), expected: 'MISSING_FIELD' });
      cases.push({ name: `null ${s.path}`, payload: wrap({ ...base, [top]: null }), expected: 'NULL_VALUE' });
      cases.push({ name: `wrong type ${s.path}`, payload: wrap({ ...base, [top]: s.type === 'string' ? 12345 : 'not-a-number' }), expected: t.type === 'enum_mapping' ? 'TYPE_MISMATCH' : 'TYPE_MISMATCH' });
    }
    if (t.type === 'rename_field' && t.renamedTo in base) {
      cases.push({ name: `conflict ${t.from} vs ${t.renamedTo}`, payload: wrap({ ...base, [t.from]: `${String(base[t.renamedTo])}-other` }), expected: 'CONFLICTING_VALUES' });
      cases.push({ name: `legacy ${t.from} still accepted`, payload: wrap({ ...without(base, t.renamedTo), [t.from]: base[t.renamedTo] }), expected: 'OK' });
    }
    if (t.type === 'enum_mapping' && t.from in base) cases.push({ name: `unknown enum value for ${t.from}`, payload: wrap({ ...base, [t.from]: '__unmapped__' }), expected: 'UNMAPPED_ENUM_VALUE' });
  }
  cases.push({ name: 'unexpected extra field is dropped, not fatal', payload: wrap({ ...base, __extra__: true }), expected: 'OK' });
  cases.push({ name: 'non-object payload', payload: 'nope', expected: 'INVALID_PAYLOAD' });
  if (endpoint.contract === 'Payment') {
    const amountSrc = transforms.find((t) => t.type === 'field_path_mapping')?.type === 'field_path_mapping' ? (transforms.find((t) => t.type === 'field_path_mapping') as Extract<Transform, { type: 'field_path_mapping' }>).mappings.find((m) => m.internalField === 'amount')?.from : undefined;
    const key = amountSrc && amountSrc in base ? amountSrc : 'amount' in base ? 'amount' : null;
    if (key) cases.push({ name: 'negative amount violates the internal contract', payload: wrap({ ...base, [key]: -1 }), expected: 'CONTRACT_VIOLATION' });
  }
  return cases.map((c) => {
    const r = run(c.payload);
    const codes = r.rejections.map((x) => x.code);
    const passed = c.expected === 'OK' ? r.ok : !r.ok && codes.includes(c.expected);
    return { name: c.name, expectedCode: c.expected, actualOk: r.ok, actualCodes: [...new Set(codes)], passed };
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export type { StoredObservation };
