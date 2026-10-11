import { Router } from 'express';

export interface HealthDeps {
  serviceName: string;
  version: string;
  /** Resolves when the database answers; rejects or times out otherwise. */
  checkDatabase: () => Promise<void>;
  /** Milliseconds allowed for the readiness probe. */
  readinessTimeoutMs?: number;
}

export interface HealthBody {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessBody {
  status: 'ready' | 'not_ready';
  checks: { database: { status: 'up' | 'down'; latencyMs: number; error?: string } };
  timestamp: string;
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();
  const timeoutMs = deps.readinessTimeoutMs ?? 2_000;

  const liveness = (): HealthBody => ({
    status: 'ok',
    service: deps.serviceName,
    version: deps.version,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });

  // Liveness: the process is up. Never touches the database.
  router.get('/', (_req, res) => {
    res.json(liveness());
  });
  router.get('/live', (_req, res) => {
    res.json(liveness());
  });

  // Readiness: can the service do useful work (database reachable)?
  router.get('/ready', async (_req, res) => {
    const started = performance.now();
    let database: ReadinessBody['checks']['database'];
    try {
      await withTimeout(deps.checkDatabase(), timeoutMs);
      database = { status: 'up', latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      database = {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : 'unknown error',
      };
    }
    const body: ReadinessBody = {
      status: database.status === 'up' ? 'ready' : 'not_ready',
      checks: { database },
      timestamp: new Date().toISOString(),
    };
    res.status(body.status === 'ready' ? 200 : 503).json(body);
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
