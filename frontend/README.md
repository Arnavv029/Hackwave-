# API Guardian dashboard

React 19 + Vite + Tailwind frontend for the DriftGuard backend. Every number on
screen comes from the backend; there is no mock data. See
[docs/PHASE9.md](../../docs/PHASE9.md) for the workflow and API.

## Run

```bash
# 1. backend (needs PostgreSQL; see ../Backend/README.md)
cd Hackwave/Backend && npm run dev            # http://127.0.0.1:3000

# 2. frontend
cd Hackwave/frontend && npm install && npm run dev   # http://localhost:5173
```

The dev server proxies `/api` and `/health` to the backend
(`VITE_BACKEND_PROXY_TARGET`, default `http://127.0.0.1:3000`), so the browser
talks to one origin. For a production build, serve `dist/` behind the same
origin as the API or set `VITE_API_BASE_URL`.

## Sign in

Click **Sign in** (header badge or landing page), enter your name and the
backend `OPERATOR_TOKEN` (from `Hackwave/Backend/.env`). The token is verified
against `/api/auth/whoami`, kept in this tab's `sessionStorage`, and sent as a
bearer header on every write. Without it the dashboard is read-only.

## Demo APIs

Twenty built-in APIs under `http://127.0.0.1:3000/mock/demo/...`: four always
correct, eleven that change about two minutes after their first call, one that
flaps, four that always fail. Paste any of them into **Add API** by hand (the
modal has a copy list, nothing is pre-filled), test, save, and watch. Full table
with expected outcomes: [docs/DEMO-APIS.md](../../docs/DEMO-APIS.md).
Settings → Showcase APIs shows their live state with *Break now* / *Restore* /
*Register all*.

## Demo APIs

Twenty built-in APIs under `http://127.0.0.1:3000/mock/demo/...`: four always
correct, eleven that change about two minutes after their first call, one that
flaps, four that always fail. Paste any of them into **Add API** by hand (the
modal has a copy list, nothing is pre-filled), test, save, and watch. Full table
with expected outcomes: [docs/DEMO-APIS.md](../../docs/DEMO-APIS.md).
Settings → Showcase APIs shows their live state with *Break now* / *Restore* /
*Register all*.

## Walkthrough

1. **Dashboard → Add API**: paste any JSON endpoint URL (for a local demo use
   the backend's mock provider, e.g. `POST http://127.0.0.1:3000/mock/payments/charges`
   with body `{"amount":1250,"currency":"USD","source_token":"tok_demo"}`,
   or `GET http://127.0.0.1:3000/mock/shipping/shipments`). *Test Connection*
   runs a real request; *Save* registers the monitor and runs the first check.
   With "approve first response as baseline" ticked the baseline is locked
   immediately, otherwise an **Approve baseline** button appears in the row.
2. **Incidents & Impact → Map Feature**: register which application features
   read which JSON path (`$.transaction_id`, `$.data[].sku`, …).
3. Change the provider (Settings → *Sandbox providers* → payments →
   `schema_rename`, or change your own API) and press the refresh icon on the
   row, or wait for the scheduler.
4. The incident appears with baseline vs latest response, field diffs
   (removed / renamed / type mismatch / added) and the affected features.
5. **Recovery & Validation**: the drafted declarative adapter, its
   assumptions and risks. *Run Validation Test* executes the sandbox contract
   test and streams its log; *Approve*; *Promote Adapter to Gateway*. The next
   check runs through the adapter and the incident resolves itself.
6. **Reports** and **Audit Log** are generated from the same data.

## Scripts

```bash
npm run dev        # Vite with backend proxy
npm run typecheck  # tsc
npm test           # Vitest + Testing Library (mappers, Add API modal, incident page)
npm run build      # typecheck + production bundle
```
