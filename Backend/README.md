# DriftGuard backend (Phases 1–7)

The Phase 8 dashboard lives in [`../Frontend`](../Frontend/README.md) and
talks to this API through a dev proxy (see [docs/PHASE8.md](../../docs/PHASE8.md)).

Control plane for API dependency monitoring and self-healing. Phase 1 delivers
the foundation: project tooling, the PostgreSQL data model, environment
validation, structured logging, centralized error handling and health checks.
Phase 2 adds mock Payments/Shipping providers with fault scenarios, a bounded
provider client, the observation engine and the observation API. See
[docs/PHASE2.md](../../docs/PHASE2.md) for endpoints, scenarios, example
requests and reproduction steps. Phase 3 adds versioned, reviewed baselines,
deterministic change detection and the findings API; see
[docs/PHASE3.md](../../docs/PHASE3.md), including its detection limitations.
Phase 4 adds the typed dependency graph, BFS impact analysis and impact
reports; see [docs/PHASE4.md](../../docs/PHASE4.md) for the edge-direction
convention. Phase 5 adds the deterministic repair engine (versioned data
rules, controlled adapter, gated activation); see
[docs/PHASE5.md](../../docs/PHASE5.md) for how to register a rule. Phase 6
adds AI-assisted proposals for unfamiliar changes (model proposes, backend
validates, humans approve); see [docs/PHASE6.md](../../docs/PHASE6.md),
including what the model cannot safely infer. Phase 7 adds the validation
pipeline, approval policy, atomic activation pointer, post-activation
verification and rollback; see [docs/PHASE7.md](../../docs/PHASE7.md).

## Stack

Node.js 22+, TypeScript (strict), Express 5, Zod 4, PostgreSQL, Prisma 7
(`pg` driver adapter), Pino, Vitest + Supertest, ESLint (typescript-eslint).

## Layout

```
prisma.config.ts          Prisma 7 CLI config (schema path, migrations dir, datasource URL)
prisma/schema.prisma      Data model + enums
prisma/migrations/        SQL migrations (committed)
src/server.ts             Entry point: env -> logger -> prisma -> app -> http server, graceful shutdown
src/app.ts                Express app factory (no side effects; takes its dependencies)
src/config/env.ts         Zod environment schema and parser
src/logger.ts             Pino logger with secret redaction
src/errors.ts             HttpError hierarchy and error wire format
src/middleware/           Request logging, central error handler, 404 handler
src/routes/health.ts      GET /health, /health/live (liveness), /health/ready (DB probe)
src/routes/observations.ts GET /api/observations[/:id], POST /api/probes, GET /api/providers
src/routes/simulations.ts Scenario controls (/api/simulations; dev/test only, bearer token)
src/routes/baselines.ts   Baseline lifecycle: create, submit, review, promote, compare
src/routes/findings.ts    Findings list/detail/status, rule catalogue
src/detection/            Config, normalisation, summary, rules, stores, lifecycle services
src/routes/graph.ts       Graph CRUD, fixtures, what-if impact
src/routes/impact.ts      Impact reports per finding, persisted snapshots
src/graph/                Schemas, BFS traversal + ranking, fixtures, stores, service
src/routes/repairs.ts     Repair rules, proposals, adapters
src/repair/               Rule schemas, internal contracts + adapters, engine, matcher, stores, service
src/routes/ai.ts          AI proposals (operator-only)
src/ai/                   Change report, provider interface (Anthropic + mock), policy, stores, service
src/routes/activations.ts Active-version pointers, verification, rollback, safety
src/activation/           Validation pipeline, regression harnesses, approval policy, stores, lifecycle service
src/providers/contracts.ts Explicit provider endpoint contracts (Zod)
src/observation/          Provider client, schemas, shape analysis, store, engine
src/mocks/                Mock Payments/Shipping providers and scenario store
src/security/redact.ts    Redaction applied before persistence and logging
src/db/client.ts          PrismaClient factory (driver adapter) and ping
src/db/errors.ts          Prisma error helpers (unique violation detection)
src/db/types.ts           DbClient (root or transaction client), pagination helpers
src/db/repositories/      Data-access layer: one repository per aggregate
src/generated/prisma/     Generated client (git-ignored; `npm run db:generate`)
tests/unit/               Hermetic tests (no database)
tests/integration/        Repository tests against a real PostgreSQL (opt-in)
```

## Setup

1. Install dependencies (Node 22 or newer):

   ```bash
   npm install
   ```

   npm 11 blocks third-party install scripts until approved. Prisma needs its
   engines script, so approve and rebuild once:

   ```bash
   npm install-scripts approve prisma @prisma/engines esbuild
   npm rebuild prisma @prisma/engines esbuild
   ```

2. Create a PostgreSQL database. With Docker:

   ```bash
   docker compose up -d db
   ```

   This creates `driftguard` and `driftguard_test` with user `driftguard` /
   password `change-me` (local use only). Without Docker, create two databases
   on your own server and put their URLs in `.env`.

3. Configure the environment:

   ```bash
   cp .env.example .env
   # edit DATABASE_URL and TEST_DATABASE_URL
   ```

4. Generate the client and apply migrations:

   ```bash
   npm run db:generate
   npm run db:migrate        # prisma migrate dev (development)
   # or, for an existing database / CI / production:
   npm run db:deploy         # prisma migrate deploy
   ```

5. Run:

   ```bash
   npm run dev               # tsx watch, pretty logs
   curl localhost:3000/health
   curl localhost:3000/health/ready
   ```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with `tsx watch` and pretty-printed logs |
| `npm run build` | Type-check and emit `dist/` from `src/` |
| `npm start` | Run the built server (`NODE_ENV=production` recommended) |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run lint` / `lint:fix` | ESLint with type-aware rules; `any` is an error |
| `npm test` | Unit tests only (no database needed) |
| `npm run test:db` | Applies migrations to `TEST_DATABASE_URL`, then runs all tests including repository tests |
| `npm run db:generate` | Regenerate the Prisma client after schema changes |
| `npm run db:migrate` | Create/apply a migration in development (`prisma migrate dev --name <name>`) |
| `npm run db:deploy` | Apply committed migrations without generating new ones |
| `npm run db:status` | Show pending migrations |
| `npm run db:reset` | Drop, recreate and migrate the dev database (destructive) |
| `npm run db:studio` | Open Prisma Studio |

## Environment variables

See `.env.example`. All variables are validated at startup by `src/config/env.ts`;
the process exits with a list of every problem if validation fails.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` enables pretty logs and exposes error messages on 5xx |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `SERVICE_NAME` | `driftguard-api` | Appears in every log line and in `/health` |
| `LOG_LEVEL` | `info` | Pino level |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Grace period on SIGTERM/SIGINT |
| `DATABASE_URL` | required | `postgresql://...` |
| `DATABASE_POOL_MAX` | `10` | `pg` pool size |
| `TEST_DATABASE_URL` | optional | Separate database; required by `npm run test:db` |
| `MOCK_PROVIDERS_ENABLED` | `true` unless production | Mount mock providers under `/mock` |
| `SCENARIO_CONTROL_TOKEN` | unset | Enables `/api/simulations` (never in production) |
| `MOCK_PROVIDERS_BASE_URL` | `http://127.0.0.1:$PORT/mock` | Where the engine calls providers |
| `PROVIDER_TIMEOUT_MS` / `PROVIDER_MAX_RESPONSE_BYTES` | `5000` / `1048576` | Client bounds |
| `OPERATOR_TOKEN` | unset | When set, baseline review/promotion, finding status changes and repair mutations require it; `/api/ai/*` refuses to run without it |
| `AI_PROVIDER` | `disabled` | `anthropic` or `mock`; see docs/PHASE6.md for `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_MAX_REQUESTS_PER_MINUTE`, `AI_MAX_CONCURRENT`, `AI_MAX_REPORT_BYTES`, `AI_MAX_OUTPUT_TOKENS` |
| `ANTHROPIC_API_KEY` | unset | Read by the SDK when `AI_PROVIDER=anthropic`; never logged |

## Data model

Nine tables, UUID v7 primary keys, `createdAt`/`updatedAt` everywhere.

- **DependencyNode**: vertices of the dependency graph. `kind` is PROVIDER,
  OPERATION, CLIENT or WORKFLOW; `key` is a unique human-readable id. Providers
  store `baseUrl` and a `secretRef` (the name of a secret, never its value).
  Operations store `method`/`path` and point at their provider via `parentId`.
- **DependencyEdge**: directed `source -> target` with relation EXPOSES, CALLS
  or CONSUMES; unique per `(sourceId, targetId, relation)`.
- **Observation**: one sanitized call record per operation: outcome, status,
  latency, normalized request/response shapes, bounded sample, header subset.
- **Baseline**: versioned expected behavior per operation; unique
  `(nodeId, version)`; the repository keeps at most one ACTIVE per node.
- **Finding**: a deviation from a baseline with category, severity, confidence
  and JSON evidence; unique `(baselineId, fingerprint)` so repeats bump
  `occurrenceCount` instead of duplicating.
- **RepairProposal**: a proposed fix for a finding plus its gating state
  (risk, human-review flag, blocked reason, reviewer).
- **RepairVersion**: immutable adapter specs per proposal with a checksum;
  unique `(proposalId, version)`; at most one ACTIVE per proposal.
- **TestRun**: regression run of a workflow against a repair version.
- **AuditEvent**: append-only log of decisions, indexed by entity and
  correlation id.

Foreign keys cascade from node downward; a finding's `observationId` is set
to null if the observation is removed.

## Logging and secrets

- Request logs serialize only `id`, `method`, `url`, `remoteAddress` and the
  response status code. Headers are never logged.
- The logger redacts `authorization`, `cookie`, `x-api-key`, `password`,
  `secret`, `token`, `apiKey` and similar keys at any depth as a second line
  of defence.
- 5xx responses hide the internal message when `NODE_ENV=production`.
- Store a `secretRef` on provider nodes and resolve it from the environment at
  call time. Never persist a secret value or a raw authorization header.

## Tests

```bash
npm test                 # unit (184): Phase 1 suites + redaction, shape analysis, provider client,
                         # mock providers/scenario controls, observation engine and API, detection rules,
                         # baseline lifecycle and findings, graph traversal and API, repair engine and flow,
                         # AI proposals with a mocked provider, validation/activation/verification/rollback
npm run test:db          # + repository, observation, detection, graph, repair, AI and activation persistence tests on PostgreSQL (202)
```

Repository tests truncate every table in the test database before each case.
They refuse to run if `TEST_DATABASE_URL` equals `DATABASE_URL`.
