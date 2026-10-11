import type { RiskLevel } from '../generated/prisma/client.js';
import type { AdapterEndpointDefinition } from '../repair/adapters.js';
import type { ProposalRecord, VersionRecord } from '../repair/stores.js';

/**
 * Approval policy: how many distinct human approvals a candidate needs
 * before activation, derived from risk, transformation type, provenance and
 * test coverage. Automatic activation is never allowed; the floor is one.
 */
export interface ApprovalRequirement {
  requiredApprovals: number;
  /** Approvers must differ from the proposal creator and from the activator. */
  distinctFromCreator: true;
  distinctFromActivator: true;
  reasons: string[];
  financial: boolean;
  riskConsidered: RiskLevel;
}

export interface PolicyInput {
  proposal: ProposalRecord;
  version: VersionRecord;
  endpoint: AdapterEndpointDefinition;
  /** From the latest validation report. */
  selectedTests: number;
  mandatoryFailures: number;
  impactMaxLikelihood: string | null;
  impactHasCriticalDependents: boolean;
}

export function approvalPolicy(input: PolicyInput): ApprovalRequirement {
  const reasons: string[] = ['human approval is always required'];
  let required = 1;
  const bump = (why: string): void => {
    required = Math.min(3, required + 1);
    reasons.push(why);
  };
  const types = input.version.spec.transforms.map((t) => t.type);
  if (input.proposal.risk === 'HIGH') bump('proposal risk is HIGH');
  if (input.proposal.derived) bump('transform was derived from a rename candidate, not spelled out in a rule');
  if (input.proposal.ruleKey?.startsWith('ai.')) bump('rule originated from an AI proposal');
  if (types.includes('enum_mapping')) bump('enum mappings change meaning, not just shape');
  if (input.selectedTests === 0) bump('no regression tests cover the impacted path');
  if (input.impactHasCriticalDependents && required < 2) bump('HIGH-likelihood impact on CRITICAL/HIGH dependents');
  if (input.endpoint.financial) reasons.push('financial endpoint: activation is manual and confirmed; verification uses sandbox calls only');
  return { requiredApprovals: Math.min(required, 2), distinctFromCreator: true, distinctFromActivator: true, reasons, financial: input.endpoint.financial === true, riskConsidered: input.proposal.risk };
}
