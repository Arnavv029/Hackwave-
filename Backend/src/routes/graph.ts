import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { GraphService } from '../graph/service.js';
import { createEdgeSchema, createNodeSchema, impactByNodeQuerySchema, listEdgesQuerySchema, listNodesQuerySchema, updateEdgeSchema, updateNodeSchema, ALLOWED_EDGES } from '../graph/schemas.js';

export interface GraphRouterDeps {
  service: GraphService;
  requireOperator: RequestHandler;
}

const idSchema = z.string().uuid();
const page = (limit: number, offset: number, count: number, total: number) => ({ limit, offset, total, hasMore: offset + count < total });

/**
 *   GET    /api/graph                    whole graph (bounded) + conventions
 *   GET    /api/graph/nodes              list; POST creates (operator); PUT upserts by key (operator)
 *   GET    /api/graph/nodes/:idOrKey     PATCH / DELETE (operator); URL-encode keys containing "/" 
 *   GET    /api/graph/edges              list; POST creates (operator); PUT upserts (operator)
 *   GET    /api/graph/edges/:id          PATCH / DELETE (operator)
 *   GET    /api/graph/fixtures           POST /api/graph/fixtures/:name loads one (operator)
 *   GET    /api/graph/impact?node=&path= what-if impact for a node without a finding
 */
export function createGraphRouter(deps: GraphRouterDeps): Router {
  const router = Router();
  const s = deps.service;

  router.get('/', async (_req, res) => {
    const snapshot = await s.snapshot(2_000, 10_000);
    res.json({
      data: { nodes: snapshot.nodes, edges: snapshot.edges, truncated: snapshot.truncated },
      conventions: {
        direction: 'source -> target is upstream -> downstream: a change in source can affect target. Impact analysis follows outgoing edges.',
        allowedEdges: Object.fromEntries(Object.entries(ALLOWED_EDGES).map(([rel, pairs]) => [rel, pairs.map(([a, b]) => `${a} -> ${b}`)])),
        provenance: { OBSERVED: 'derived from traffic', MANUAL: 'registered via API', INFERRED: 'tooling guess, unconfirmed' },
      },
    });
  });

  router.get('/nodes', async (req, res) => {
    const q = listNodesQuerySchema.parse(req.query);
    const r = await s.listNodes(q);
    res.json({ data: r.rows, page: page(q.limit, q.offset, r.rows.length, r.total) });
  });
  router.post('/nodes', deps.requireOperator, async (req, res) => {
    res.status(201).json({ data: await s.createNode(createNodeSchema.parse(req.body), 'create') });
  });
  router.put('/nodes', deps.requireOperator, async (req, res) => {
    res.json({ data: await s.createNode(createNodeSchema.parse(req.body), 'upsert') });
  });
  router.get('/nodes/:idOrKey', async (req, res) => {
    const node = await s.getNode(String(req.params['idOrKey']));
    const [outgoing, incoming] = await Promise.all([s.listEdges({ sourceId: node.id, limit: 500, offset: 0 }), s.listEdges({ targetId: node.id, limit: 500, offset: 0 })]);
    res.json({ data: { ...node, outgoing: outgoing.rows, incoming: incoming.rows } });
  });
  router.patch('/nodes/:idOrKey', deps.requireOperator, async (req, res) => {
    res.json({ data: await s.updateNode(String(req.params['idOrKey']), updateNodeSchema.parse(req.body)) });
  });
  router.delete('/nodes/:idOrKey', deps.requireOperator, async (req, res) => {
    await s.deleteNode(String(req.params['idOrKey']));
    res.status(204).end();
  });

  router.get('/edges', async (req, res) => {
    const q = listEdgesQuerySchema.parse(req.query);
    const sourceId = q.from ? (await s.getNode(q.from)).id : undefined;
    const targetId = q.to ? (await s.getNode(q.to)).id : undefined;
    const r = await s.listEdges({ ...(sourceId ? { sourceId } : {}), ...(targetId ? { targetId } : {}), ...(q.relation ? { relation: q.relation } : {}), ...(q.provenance ? { provenance: q.provenance } : {}), limit: q.limit, offset: q.offset });
    res.json({ data: r.rows, page: page(q.limit, q.offset, r.rows.length, r.total) });
  });
  router.post('/edges', deps.requireOperator, async (req, res) => {
    res.status(201).json({ data: await s.createEdge(createEdgeSchema.parse(req.body), 'create') });
  });
  router.put('/edges', deps.requireOperator, async (req, res) => {
    res.json({ data: await s.createEdge(createEdgeSchema.parse(req.body), 'upsert') });
  });
  router.get('/edges/:id', async (req, res) => {
    res.json({ data: await s.getEdge(idSchema.parse(req.params['id'])) });
  });
  router.patch('/edges/:id', deps.requireOperator, async (req, res) => {
    res.json({ data: await s.updateEdge(idSchema.parse(req.params['id']), updateEdgeSchema.parse(req.body)) });
  });
  router.delete('/edges/:id', deps.requireOperator, async (req, res) => {
    await s.deleteEdge(idSchema.parse(req.params['id']));
    res.status(204).end();
  });

  router.get('/fixtures', (_req, res) => {
    res.json({ data: s.listFixtures() });
  });
  router.post('/fixtures/:name', deps.requireOperator, async (req, res) => {
    res.json({ data: await s.loadFixture(String(req.params['name'])) });
  });

  router.get('/impact', async (req, res) => {
    const { node, path, ...limits } = impactByNodeQuerySchema.parse(req.query);
    res.json({ data: await s.impactForNode(node, path ? { changedPath: path } : {}, limits) });
  });

  return router;
}
