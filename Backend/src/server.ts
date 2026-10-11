import 'dotenv/config';
import { createServer } from 'node:http';
import { buildApp } from './app.js';
import { getEnv, EnvValidationError } from './config/env.js';
import { createLogger } from './logger.js';
import { createPrismaClient, pingDatabase } from './db/client.js';
import { APP_VERSION } from './version.js';
import { PrismaObservationStore } from './observation/store.js';
import { PrismaBaselineStore, PrismaFindingStore } from './detection/stores.js';
import { PrismaGraphStore, PrismaImpactReportStore } from './graph/stores.js';
import { PrismaProposalStore, PrismaRuleStore } from './repair/stores.js';
import { PrismaAiProposalStore } from './ai/stores.js';
import { PrismaActivationStore } from './activation/stores.js';
import { PrismaGuardianStore } from './guardian/store.js';
import {
  AnthropicProposalProvider,
  MockProposalProvider,
  OpenAiProposalProvider,
  GeminiProposalProvider,
  GrokProposalProvider,
  FallbackChainProposalProvider,
  type AiProposalProvider,
} from './ai/provider.js';

function createSingleProvider(name: string, env: ReturnType<typeof getEnv>): AiProposalProvider | null {
  switch (name) {
    case 'grok':
      return new GrokProposalProvider({ model: env.AI_MODEL || 'grok-beta', ...(env.GROK_API_KEY ? { apiKey: env.GROK_API_KEY } : {}) });
    case 'anthropic':
      return new AnthropicProposalProvider({ model: env.AI_MODEL, ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}) });
    case 'openai':
      return new OpenAiProposalProvider({ model: env.AI_MODEL || 'gpt-4o-mini', ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}) });
    case 'gemini':
      return new GeminiProposalProvider({ model: env.AI_MODEL || 'gemini-1.5-pro', ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}) });
    case 'mock':
      return new MockProposalProvider();
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    pretty: env.NODE_ENV === 'development',
  });

  const prisma = createPrismaClient({
    connectionString: env.DATABASE_URL,
    poolMax: env.DATABASE_POOL_MAX,
  });

  const mockProvidersEnabled = env.MOCK_PROVIDERS_ENABLED ?? env.NODE_ENV !== 'production';
  const mockBaseUrl = env.MOCK_PROVIDERS_BASE_URL ?? `http://127.0.0.1:${env.PORT}/mock`;

  // Build provider chain: Primary (e.g. Grok) + any configured fallback providers
  let aiProvider: AiProposalProvider | null = null;
  if (env.AI_PROVIDER !== 'disabled') {
    const primary = createSingleProvider(env.AI_PROVIDER, env);
    if (primary) {
      const fallbackNames = (env.AI_FALLBACK_PROVIDERS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== env.AI_PROVIDER);

      const fallbacks = fallbackNames
        .map((name) => createSingleProvider(name, env))
        .filter((p): p is AiProposalProvider => p !== null);

      if (fallbacks.length > 0) {
        aiProvider = new FallbackChainProposalProvider({
          providers: [primary, ...fallbacks],
          onFallback: (failed, err, next) => {
            logger.warn({ failedProvider: failed, error: err.message, nextProvider: next }, 'AI provider limits/error encountered; failing over to next provider in chain');
          },
        });
      } else {
        aiProvider = primary;
      }
    }
  }

  const { app, scenarioControlsEnabled, scheduler } = buildApp({
    logger,
    serviceName: env.SERVICE_NAME,
    version: APP_VERSION,
    nodeEnv: env.NODE_ENV,
    checkDatabase: () => pingDatabase(prisma),
    observationStore: new PrismaObservationStore(prisma),
    baselineStore: new PrismaBaselineStore(prisma),
    findingStore: new PrismaFindingStore(prisma),
    graphStore: new PrismaGraphStore(prisma),
    impactReportStore: new PrismaImpactReportStore(prisma),
    ruleStore: new PrismaRuleStore(prisma),
    proposalStore: new PrismaProposalStore(prisma),
    activationStore: new PrismaActivationStore(prisma),
    guardian: {
      store: new PrismaGuardianStore(prisma),
      secretKey: env.MONITOR_SECRET_KEY ?? null,
      allowPrivateNetworks: env.MONITOR_ALLOW_PRIVATE_NETWORKS ?? env.NODE_ENV !== 'production',
      schedulerEnabled: env.MONITOR_SCHEDULER_ENABLED ?? true,
      schedulerTickMs: env.MONITOR_SCHEDULER_TICK_MS,
      maxConcurrentChecks: env.MONITOR_MAX_CONCURRENT_CHECKS,
    },
    ai: {
      provider: aiProvider,
      store: new PrismaAiProposalStore(prisma),
      limits: {
        timeoutMs: env.AI_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
        maxRequestsPerMinute: env.AI_MAX_REQUESTS_PER_MINUTE,
        maxConcurrent: env.AI_MAX_CONCURRENT,
        maxReportBytes: env.AI_MAX_REPORT_BYTES,
        maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
      },
    },
    ...(env.OPERATOR_TOKEN ? { operatorToken: env.OPERATOR_TOKEN } : {}),
    mockProviders: {
      enabled: mockProvidersEnabled,
      ...(env.SCENARIO_CONTROL_TOKEN ? { controlToken: env.SCENARIO_CONTROL_TOKEN } : {}),
    },
    providerClient: {
      baseUrl: () => mockBaseUrl,
      // Secrets are resolved by name from the process environment at call time and never stored.
      resolveSecret: (ref) => process.env[ref],
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      maxResponseBytes: env.PROVIDER_MAX_RESPONSE_BYTES,
    },
  });

  const server = createServer(app);

  await listenWithRetry(server, env.PORT, env.HOST, logger);
  if (env.MONITOR_SCHEDULER_ENABLED ?? true) scheduler.start();
  logger.info(
    { host: env.HOST, port: env.PORT, nodeEnv: env.NODE_ENV, mockProviders: mockProvidersEnabled, scenarioControls: scenarioControlsEnabled, aiProvider: env.AI_PROVIDER, aiModel: aiProvider ? aiProvider.model : null, monitorScheduler: scheduler.active, monitorSecrets: Boolean(env.MONITOR_SECRET_KEY) },
    'server listening',
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown requested');
    scheduler.stop();

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out; exiting forcefully');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close((closeErr) => {
      if (closeErr) logger.error({ err: closeErr }, 'error closing http server');
      prisma
        .$disconnect()
        .catch((err: unknown) => logger.error({ err }, 'error disconnecting prisma'))
        .finally(() => {
          logger.info('shutdown complete');
          process.exit(closeErr ? 1 : 0);
        });
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    shutdown('SIGTERM');
  });
}

/**
 * Bind the port, retrying while a previous instance is still shutting down.
 * If the port stays busy, exit with an actionable message instead of leaving
 * a watcher (tsx watch / nodemon) idle with a dead server behind it.
 */
async function listenWithRetry(server: ReturnType<typeof createServer>, port: number, host: string, logger: ReturnType<typeof createLogger>, attempts = 10, delayMs = 1_000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException): void => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= attempts) {
        if (code === 'EADDRINUSE') {
          process.stderr.write(
            `fatal: port ${port} is still in use after ${attempts} attempts.\n` +
              `       Another DriftGuard instance (or another app) is listening there.\n` +
              `       Find it with:  ss -ltnp | grep ':${port} '   then stop it, or start this server with PORT=<other>.\n`,
          );
          process.exit(1);
        }
        throw err;
      }
      logger.warn({ port, attempt, attempts }, 'port in use; waiting for the previous instance to release it');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

main().catch((err: unknown) => {
  // The logger may not exist yet if env validation failed, so use stderr.
  const message = err instanceof EnvValidationError ? err.message : String(err);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
});
