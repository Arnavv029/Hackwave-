import express, { type Express } from 'express';
import type { Logger } from './logger.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './routes/health.js';
import { createObservationsRouter } from './routes/observations.js';
import { createSimulationsRouter } from './routes/simulations.js';
import { createMockProvidersRouter, ScenarioStore, DemoStore } from './mocks/index.js';
import { createDemoRouter } from './routes/demo.js';
import { ObservationEngine } from './observation/service.js';
import { ProviderClient } from './observation/provider-client.js';
import type { ObservationStore } from './observation/store.js';
import type { ProviderKey } from './providers/contracts.js';
import { createBaselinesRouter } from './routes/baselines.js';
import { createFindingsRouter } from './routes/findings.js';
import { BaselineService } from './detection/baseline-service.js';
import { DetectionService, FindingService } from './detection/detection-service.js';
import type { BaselineStore, FindingStore } from './detection/stores.js';
import { requireBearerToken } from './middleware/bearer-auth.js';
import { GraphService } from './graph/service.js';
import type { GraphStore, ImpactReportStore } from './graph/stores.js';
import { createGraphRouter } from './routes/graph.js';
import { createFindingImpactRouter, createImpactReportsRouter } from './routes/impact.js';
import { RepairService } from './repair/service.js';
import type { ProposalStore, RuleStore } from './repair/stores.js';
import { createAdaptersRouter, createRepairRulesRouter, createRepairsRouter } from './routes/repairs.js';
import { AiRepairService, type AiServiceLimits } from './ai/service.js';
import type { AiProposalProvider } from './ai/provider.js';
import type { AiProposalStore } from './ai/stores.js';
import { createAiRouter } from './routes/ai.js';
import { ServiceUnavailableError } from './errors.js';
import { ActivationService } from './activation/service.js';
import type { ActivationStore } from './activation/stores.js';
import { createActivationsRouter } from './routes/activations.js';
import type { RequestHandler } from 'express';
import type { GuardianStore } from './guardian/store.js';
import { GuardianEvents } from './guardian/events.js';
import { GuardianEngine } from './guardian/engine.js';
import { GuardianService } from './guardian/service.js';
import { MonitorScheduler } from './guardian/scheduler.js';
import { SecretBox } from './guardian/secrets.js';
import { createGuardianRouter } from './routes/guardian.js';

export interface AppDeps {
  logger: Logger;
  serviceName: string;
  version: string;
  nodeEnv: 'development' | 'test' | 'production';
  checkDatabase: () => Promise<void>;

  /** Phase 2: where observations are persisted. */
  observationStore: ObservationStore;
  /** Phase 3: baselines and findings. */
  baselineStore: BaselineStore;
  findingStore: FindingStore;
  /** Phase 4: dependency graph and impact snapshots. */
  graphStore: GraphStore;
  impactReportStore: ImpactReportStore;
  /** Phase 5: repair rules and proposals. */
  ruleStore: RuleStore;
  proposalStore: ProposalStore;
  /** Phase 7: validation runs, approvals, activation pointer, events, verification. */
  activationStore: ActivationStore;
  /** Phase 9: URL monitors, incidents, proposals (API Guardian workflow). */
  guardian: {
    store: GuardianStore;
    /** Passphrase for credential encryption; null disables secret storage. */
    secretKey: string | null;
    allowPrivateNetworks: boolean;
    schedulerEnabled: boolean;
    schedulerTickMs?: number;
    maxConcurrentChecks?: number;
  };
  /** Phase 6: AI proposals. `provider` null = disabled. */
  ai: {
    provider: AiProposalProvider | null;
    store: AiProposalStore;
    limits: AiServiceLimits;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  };
  /** Phase 3: when set, baseline review/promotion and finding status changes require this bearer token. */
  operatorToken?: string;
  /** Phase 2: mock providers under /mock. Scenario controls additionally need `controlToken` and a non-production env. */
  mockProviders: {
    enabled: boolean;
    controlToken?: string;
    /** Shared so tests can inspect/reset state directly; a new store is created when omitted. */
    scenarioStore?: ScenarioStore;
  };
  /** Phase 2: provider client settings. */
  providerClient: {
    /** Base URL under which `/<provider>` is reachable, evaluated per call (server port may be unknown at build time). */
    baseUrl: (provider: ProviderKey) => string;
    resolveSecret: (secretRef: string) => string | undefined;
    timeoutMs: number;
    maxResponseBytes: number;
    fetchImpl?: typeof fetch;
  };
}

export interface BuiltApp {
  app: Express;
  scenarioStore: ScenarioStore;
  engine: ObservationEngine;
  baselineService: BaselineService;
  detectionService: DetectionService;
  findingService: FindingService;
  graphService: GraphService;
  repairService: RepairService;
  aiService: AiRepairService;
  activationService: ActivationService;
  guardianService: GuardianService;
  guardianEvents: GuardianEvents;
  guardianEngine: GuardianEngine;
  scheduler: MonitorScheduler;
  /** Showcase ("problem") APIs state; null when mock providers are disabled. */
  demoStore: DemoStore | null;
  /** True when /api/simulations is mounted. */
  scenarioControlsEnabled: boolean;
}

/**
 * Build the Express application. Pure function of its dependencies so tests
 * can supply fakes without touching Prisma or the network.
 */
export function createApp(deps: AppDeps): Express {
  return buildApp(deps).app;
}

export function buildApp(deps: AppDeps): BuiltApp {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(createRequestLogger(deps.logger));
  app.use(express.json({ limit: '1mb' }));

  app.use(
    '/health',
    createHealthRouter({
      serviceName: deps.serviceName,
      version: deps.version,
      checkDatabase: deps.checkDatabase,
    }),
  );

  // --- Phase 2 -------------------------------------------------------------
  const scenarioStore = deps.mockProviders.scenarioStore ?? new ScenarioStore();
  const engine = new ObservationEngine({
    client: new ProviderClient({ fetchImpl: deps.providerClient.fetchImpl }),
    store: deps.observationStore,
    logger: deps.logger,
    providerBaseUrl: deps.providerClient.baseUrl,
    resolveSecret: deps.providerClient.resolveSecret,
    defaultTimeoutMs: deps.providerClient.timeoutMs,
    defaultMaxResponseBytes: deps.providerClient.maxResponseBytes,
  });

  // --- Phase 3 -------------------------------------------------------------
  const baselineService = new BaselineService({ baselines: deps.baselineStore, observations: deps.observationStore, logger: deps.logger });
  const detectionService = new DetectionService({ baselines: deps.baselineStore, findings: deps.findingStore, observations: deps.observationStore, logger: deps.logger });
  const findingService = new FindingService(deps.findingStore);
  const requireOperator: RequestHandler = deps.operatorToken ? requireBearerToken(deps.operatorToken) : (_req, _res, next) => next();

  app.use('/api', createObservationsRouter({ store: deps.observationStore, engine, detection: detectionService }));
  app.use('/api/baselines', createBaselinesRouter({ service: baselineService, requireOperator }));
  app.use('/api/findings', createFindingsRouter({ service: findingService, requireOperator }));

  // --- Phase 4 -------------------------------------------------------------
  const graphService = new GraphService({ graph: deps.graphStore, reports: deps.impactReportStore, findings: deps.findingStore, logger: deps.logger });
  app.use('/api/graph', createGraphRouter({ service: graphService, requireOperator }));
  app.use('/api/findings/:id/impact', createFindingImpactRouter({ service: graphService, requireOperator }));
  app.use('/api/impact-reports', createImpactReportsRouter({ service: graphService }));

  // --- Phase 5 -------------------------------------------------------------
  // Activation service is created first so the repair runtime resolves "active" through the pointer.
  let activationServiceRef: ActivationService | null = null;
  const repairService = new RepairService({
    rules: deps.ruleStore,
    proposals: deps.proposalStore,
    findings: deps.findingStore,
    observations: deps.observationStore,
    impactReports: deps.impactReportStore,
    logger: deps.logger,
    resolveActiveVersion: (a, e) => (activationServiceRef ? activationServiceRef.resolveActiveVersion(a, e) : Promise.resolve(null)),
  });
  const activationService = new ActivationService({
    store: deps.activationStore,
    proposals: deps.proposalStore,
    rules: deps.ruleStore,
    observations: deps.observationStore,
    impactReports: deps.impactReportStore,
    graph: graphService,
    probe: (input) => engine.probe(input),
    logger: deps.logger,
  });
  activationServiceRef = activationService;
  app.use('/api/repair-rules', createRepairRulesRouter({ service: repairService, requireOperator }));
  app.use('/api/repairs', createRepairsRouter({ service: repairService, activation: activationService, requireOperator }));
  app.use('/api/activations', createActivationsRouter({ service: activationService, requireOperator }));
  app.use('/api/adapters', createAdaptersRouter({ service: repairService }));

  // --- Phase 6 -------------------------------------------------------------
  const aiService = new AiRepairService({
    provider: deps.ai.provider,
    store: deps.ai.store,
    findings: deps.findingStore,
    baselines: deps.baselineStore,
    observations: deps.observationStore,
    impactReports: deps.impactReportStore,
    rules: deps.ruleStore,
    repairs: repairService,
    logger: deps.logger,
    limits: deps.ai.limits,
    ...(deps.ai.now ? { now: deps.ai.now } : {}),
    ...(deps.ai.sleep ? { sleep: deps.ai.sleep } : {}),
  });
  // AI routes demand real authentication: with no operator token configured they are unavailable rather than open.
  const requireOperatorStrict: RequestHandler = deps.operatorToken
    ? requireOperator
    : (_req, _res, next) => next(new ServiceUnavailableError('AI proposal endpoints require OPERATOR_TOKEN to be configured'));
  app.use('/api/ai', createAiRouter({ service: aiService, requireOperator: requireOperatorStrict }));

  // --- Phase 9 -------------------------------------------------------------
  const guardianEvents = new GuardianEvents();
  const secrets = deps.guardian.secretKey ? new SecretBox(deps.guardian.secretKey) : null;
  const guardianEngine = new GuardianEngine({
    store: deps.guardian.store,
    client: new ProviderClient({ fetchImpl: deps.providerClient.fetchImpl, userAgent: 'api-guardian-monitor/0.9' }),
    events: guardianEvents,
    logger: deps.logger,
    secrets,
    allowPrivateNetworks: deps.guardian.allowPrivateNetworks,
    settings: () => guardianService.monitoringSettings(),
    maxResponseBytes: deps.providerClient.maxResponseBytes,
  });
  const guardianService: GuardianService = new GuardianService({ store: deps.guardian.store, engine: guardianEngine, events: guardianEvents, secrets, logger: deps.logger, env: { allowPrivateNetworks: deps.guardian.allowPrivateNetworks, schedulerEnabled: deps.guardian.schedulerEnabled, nodeEnv: deps.nodeEnv } });
  const scheduler = new MonitorScheduler({ store: deps.guardian.store, runCheck: (id, by) => guardianEngine.runCheck(id, by), logger: deps.logger, ...(deps.guardian.schedulerTickMs ? { tickMs: deps.guardian.schedulerTickMs } : {}), ...(deps.guardian.maxConcurrentChecks ? { maxConcurrent: deps.guardian.maxConcurrentChecks } : {}) });
  app.use('/api', createGuardianRouter({ service: guardianService, events: guardianEvents, requireOperator, operatorAuthEnabled: Boolean(deps.operatorToken), operatorToken: deps.operatorToken }));

  const demoStore = deps.mockProviders.enabled ? new DemoStore() : null;
  if (deps.mockProviders.enabled && demoStore) {
    app.use('/api/demo', createDemoRouter({ store: demoStore, service: guardianService, mockBaseUrl: () => deps.providerClient.baseUrl('payments'), requireOperator }));
    app.use('/mock', createMockProvidersRouter(scenarioStore, demoStore));
  }

  // Scenario controls: never in production, never without a token. This is
  // decided at build time so no runtime flag can re-enable them.
  const scenarioControlsEnabled =
    deps.nodeEnv !== 'production' && deps.mockProviders.enabled && typeof deps.mockProviders.controlToken === 'string' && deps.mockProviders.controlToken.length > 0;
  if (scenarioControlsEnabled) {
    app.use('/api/simulations', createSimulationsRouter({ store: scenarioStore, controlToken: deps.mockProviders.controlToken as string }));
  }

  app.use(notFoundHandler);
  app.use(
    createErrorHandler({
      logger: deps.logger,
      exposeInternalErrors: deps.nodeEnv !== 'production',
    }),
  );

  return { app, scenarioStore, engine, baselineService, detectionService, findingService, graphService, repairService, aiService, activationService, guardianService, guardianEvents, guardianEngine, scheduler, demoStore, scenarioControlsEnabled };
}
