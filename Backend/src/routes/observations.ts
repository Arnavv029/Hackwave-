import { Router } from 'express';
import { NotFoundError } from '../errors.js';
import type { ObservationEngine } from '../observation/service.js';
import { listObservationsQuerySchema, observationIdSchema, probeRequestSchema } from '../observation/schemas.js';
import type { ObservationStore, StoredObservation } from '../observation/store.js';
import { providerContracts } from '../providers/contracts.js';
import type { DetectionOutcome, DetectionService } from '../detection/detection-service.js';
import { toFindingWire } from './findings.js';

export interface ObservationRouterDeps {
  store: ObservationStore;
  engine: ObservationEngine;
  /** Phase 3: compares each new observation with the ACTIVE baseline. */
  detection?: DetectionService;
}

/** Wire representation of an observation (dates as ISO strings). */
export function toWire(o: StoredObservation): Record<string, unknown> {
  return { ...o, observedAt: o.observedAt.toISOString(), createdAt: o.createdAt.toISOString() };
}

/**
 * Observation read API and the manual probe trigger.
 *
 *   GET  /api/observations            paginated, filterable, sortable list
 *   GET  /api/observations/:id        one observation
 *   POST /api/probes                  call a provider endpoint once and record it
 *   GET  /api/providers               the declared contracts (what we expect)
 */
export function createObservationsRouter(deps: ObservationRouterDeps): Router {
  const router = Router();

  router.get('/observations', async (req, res) => {
    const query = listObservationsQuerySchema.parse(req.query);
    const page = await deps.store.list(query);
    res.json({
      data: page.rows.map(toWire),
      page: {
        limit: query.limit,
        offset: query.offset,
        total: page.total,
        hasMore: query.offset + page.rows.length < page.total,
      },
      sort: { field: 'observedAt', order: query.sort },
    });
  });

  router.get('/observations/:id', async (req, res) => {
    const parsed = observationIdSchema.safeParse(req.params['id']);
    if (!parsed.success) throw new NotFoundError('Observation not found');
    const row = await deps.store.findById(parsed.data);
    if (!row) throw new NotFoundError('Observation not found');
    res.json({ data: toWire(row) });
  });

  router.post('/probes', async (req, res) => {
    const input = probeRequestSchema.parse(req.body);
    const stored = await deps.engine.probe(input);
    let detection: DetectionOutcome = { evaluated: false, reason: 'detection disabled', findings: [], suppressed: 0 };
    if (deps.detection) {
      try {
        detection = await deps.detection.evaluate(stored);
      } catch (err) {
        // The observation is already persisted; a detection bug must not hide it.
        req.log.error({ err, observationId: stored.id }, 'detection failed');
        detection = { evaluated: false, reason: 'detection error', findings: [], suppressed: 0 };
      }
    }
    res.status(201).json({ data: toWire(stored), detection: { ...detection, findings: detection.findings.map(toFindingWire) } });
  });

  router.get('/providers', (_req, res) => {
    res.json({
      data: Object.values(providerContracts).map((p) => ({
        key: p.key,
        name: p.name,
        secretRef: p.secretRef,
        endpoints: Object.entries(p.endpoints).map(([name, e]) => ({
          name,
          method: e.method,
          path: e.path,
          endpointKey: `${e.method} ${e.path}`,
          summary: e.summary,
          successStatuses: e.successStatuses,
          pathParams: e.pathParams,
          hasRequestBody: e.requestBody !== undefined,
        })),
      })),
    });
  });

  return router;
}
