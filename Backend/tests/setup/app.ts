import { createServer, type Server } from 'node:http';
import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { buildApp, type AppDeps, type BuiltApp } from '../../src/app.js';
import { createLogger } from '../../src/logger.js';
import { InMemoryObservationStore, type ObservationStore } from '../../src/observation/store.js';
import { InMemoryBaselineStore, InMemoryFindingStore, type BaselineStore, type FindingStore } from '../../src/detection/stores.js';
import { InMemoryGraphStore, InMemoryImpactReportStore, type GraphStore, type ImpactReportStore } from '../../src/graph/stores.js';
import { InMemoryProposalStore, InMemoryRuleStore, type ProposalStore, type RuleStore } from '../../src/repair/stores.js';
import { InMemoryAiProposalStore, type AiProposalStore } from '../../src/ai/stores.js';
import { InMemoryActivationStore, type ActivationStore } from '../../src/activation/stores.js';
import { InMemoryGuardianStore, type GuardianStore } from '../../src/guardian/store.js';
import { MockProposalProvider, type AiProposalProvider } from '../../src/ai/provider.js';
import type { AiServiceLimits } from '../../src/ai/service.js';

export const TEST_CONTROL_TOKEN = 'test-control-token-0123456789';
export const TEST_OPERATOR_TOKEN = 'test-operator-token-0123456789';

export interface TestAppOptions {
  nodeEnv?: 'development' | 'test' | 'production';
  checkDatabase?: () => Promise<void>;
  mockProvidersEnabled?: boolean;
  controlToken?: string | undefined;
  store?: ObservationStore;
  baselineStore?: BaselineStore;
  findingStore?: FindingStore;
  graphStore?: GraphStore;
  impactReportStore?: ImpactReportStore;
  ruleStore?: RuleStore;
  proposalStore?: ProposalStore;
  activationStore?: ActivationStore;
  guardianStore?: GuardianStore;
  guardianSecretKey?: string | null;
  allowPrivateNetworks?: boolean;
  aiProvider?: AiProposalProvider | null;
  aiStore?: AiProposalStore;
  aiLimits?: Partial<AiServiceLimits>;
  aiNow?: () => number;
  aiSleep?: (ms: number) => Promise<void>;
  /** Defaults to TEST_OPERATOR_TOKEN; pass undefined explicitly to disable operator auth. */
  operatorToken?: string | undefined;
  resolveSecret?: (ref: string) => string | undefined;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Override the provider base URL (e.g. to point at a closed port). */
  providerBaseUrl?: string;
}

export interface TestApp extends BuiltApp {
  lines: string[];
  store: ObservationStore;
  baselineStore: BaselineStore;
  findingStore: FindingStore;
  graphStore: GraphStore;
  impactReportStore: ImpactReportStore;
  ruleStore: RuleStore;
  proposalStore: ProposalStore;
  aiProvider: MockProposalProvider | AiProposalProvider | null;
  aiStore: AiProposalStore;
  activationStore: ActivationStore;
  guardianStore: GuardianStore;
  /** Starts an HTTP server so the engine can really call the mock providers. */
  listen(): Promise<{ server: Server; baseUrl: string }>;
  close(): Promise<void>;
}

/**
 * Build the app with an in-memory observation store, captured logs and mock
 * providers. `listen()` binds an ephemeral port and routes the engine's
 * provider calls back into the same server, mirroring the dev setup.
 */
export function buildTestApp(opts: TestAppOptions = {}): TestApp {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger({ level: 'debug', serviceName: 'test', destination });
  const store = opts.store ?? new InMemoryObservationStore();
  const baselineStore = opts.baselineStore ?? new InMemoryBaselineStore();
  const findingStore = opts.findingStore ?? new InMemoryFindingStore();
  const graphStore = opts.graphStore ?? new InMemoryGraphStore();
  const impactReportStore = opts.impactReportStore ?? new InMemoryImpactReportStore();
  const ruleStore = opts.ruleStore ?? new InMemoryRuleStore();
  const proposalStore = opts.proposalStore ?? new InMemoryProposalStore();
  const activationStore = opts.activationStore ?? new InMemoryActivationStore();
  const guardianStore = opts.guardianStore ?? new InMemoryGuardianStore();
  const aiProvider = opts.aiProvider === undefined ? new MockProposalProvider() : opts.aiProvider;
  const aiStore = opts.aiStore ?? new InMemoryAiProposalStore();
  const aiLimits: AiServiceLimits = { timeoutMs: 500, maxRetries: 2, maxRequestsPerMinute: 100, maxConcurrent: 2, maxReportBytes: 32_768, maxOutputTokens: 4_096, ...opts.aiLimits };
  let baseUrl = opts.providerBaseUrl ?? 'http://127.0.0.1:1/mock';
  let server: Server | undefined;

  const deps: AppDeps = {
    logger,
    serviceName: 'test',
    version: '0.0.0-test',
    nodeEnv: opts.nodeEnv ?? 'test',
    checkDatabase: opts.checkDatabase ?? (() => Promise.resolve()),
    observationStore: store,
    baselineStore,
    findingStore,
    graphStore,
    impactReportStore,
    ruleStore,
    proposalStore,
    activationStore,
    guardian: { store: guardianStore, secretKey: opts.guardianSecretKey === undefined ? 'test-secret-key-0123456789' : opts.guardianSecretKey, allowPrivateNetworks: opts.allowPrivateNetworks ?? true, schedulerEnabled: false },
    ai: { provider: aiProvider, store: aiStore, limits: aiLimits, ...(opts.aiNow ? { now: opts.aiNow } : {}), sleep: opts.aiSleep ?? (() => Promise.resolve()) },
    ...('operatorToken' in opts ? (opts.operatorToken ? { operatorToken: opts.operatorToken } : {}) : { operatorToken: TEST_OPERATOR_TOKEN }),
    mockProviders: {
      enabled: opts.mockProvidersEnabled ?? true,
      ...('controlToken' in opts ? (opts.controlToken ? { controlToken: opts.controlToken } : {}) : { controlToken: TEST_CONTROL_TOKEN }),
    },
    providerClient: {
      baseUrl: () => baseUrl,
      resolveSecret: opts.resolveSecret ?? (() => undefined),
      timeoutMs: opts.timeoutMs ?? 2_000,
      maxResponseBytes: opts.maxResponseBytes ?? 256 * 1024,
    },
  };
  const built = buildApp(deps);

  return {
    ...built,
    lines,
    store,
    baselineStore,
    findingStore,
    graphStore,
    impactReportStore,
    ruleStore,
    proposalStore,
    aiProvider,
    aiStore,
    activationStore,
    guardianStore,
    async listen() {
      server = createServer(built.app);
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}`;
      if (!opts.providerBaseUrl) baseUrl = `${url}/mock`;
      return { server, baseUrl: url };
    },
    async close() {
      if (!server) return;
      const s = server;
      server = undefined;
      s.closeAllConnections();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    },
  };
}
