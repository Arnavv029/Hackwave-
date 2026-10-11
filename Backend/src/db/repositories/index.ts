import type { DbClient } from '../types.js';
import { DependencyNodeRepository } from './dependency-node.repository.js';
import { DependencyEdgeRepository } from './dependency-edge.repository.js';
import { ObservationRepository } from './observation.repository.js';
import { BaselineRepository } from './baseline.repository.js';
import { FindingRepository } from './finding.repository.js';
import { RepairProposalRepository, RepairVersionRepository } from './repair.repository.js';
import { TestRunRepository } from './test-run.repository.js';
import { AuditEventRepository } from './audit-event.repository.js';

export interface Repositories {
  nodes: DependencyNodeRepository;
  edges: DependencyEdgeRepository;
  observations: ObservationRepository;
  baselines: BaselineRepository;
  findings: FindingRepository;
  proposals: RepairProposalRepository;
  repairVersions: RepairVersionRepository;
  testRuns: TestRunRepository;
  audit: AuditEventRepository;
}

/** Bind every repository to one client (root client or a transaction client). */
export function createRepositories(db: DbClient): Repositories {
  return {
    nodes: new DependencyNodeRepository(db),
    edges: new DependencyEdgeRepository(db),
    observations: new ObservationRepository(db),
    baselines: new BaselineRepository(db),
    findings: new FindingRepository(db),
    proposals: new RepairProposalRepository(db),
    repairVersions: new RepairVersionRepository(db),
    testRuns: new TestRunRepository(db),
    audit: new AuditEventRepository(db),
  };
}

export * from './dependency-node.repository.js';
export * from './dependency-edge.repository.js';
export * from './observation.repository.js';
export * from './baseline.repository.js';
export * from './finding.repository.js';
export * from './repair.repository.js';
export * from './test-run.repository.js';
export * from './audit-event.repository.js';
