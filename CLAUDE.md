# Handoff — notes for Claude sessions

AI relocation autopilot. Full product spec lives in `PLAN.md` (decisions, structure, routes, phase checklist).
Stack: React + TypeScript (Vite) in `frontend/`, FastAPI + Motor in `backend/`, MongoDB. Deploys on Emergent.

## Run locally

```bash
# backend (port 8001)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # fill in keys; MONGO_URL=mongomock://local runs an in-memory DB (demo auto-seeds)
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --reload --timeout-graceful-shutdown 3

# frontend (port 3000; proxies /api to :8001 when REACT_APP_BACKEND_URL is empty)
cd frontend
yarn install
yarn start
```

Seed the demo into a real Mongo: `cd backend && .venv/bin/python seed.py` (Maya, maya@handoff.demo / handoff-demo).
The login page's **Try the demo** button and Settings → **Reset demo** call `POST /api/demo/reset`.

## Checks

```bash
cd backend && STEP_DELAY=0 .venv/bin/python -m pytest -q && .venv/bin/ruff check . && .venv/bin/ruff format --check .
cd frontend && yarn typecheck && yarn lint && yarn build
cd frontend && yarn e2e            # Playwright smoke test of the demo story (needs both servers running)
```

## Environment variables

Backend (`backend/.env`, names in `backend/.env.example`):
- `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS` — Emergent standard names. `mongomock://local` = in-memory.
- `JWT_SECRET` — required in production. `FRONTEND_URL` — public frontend origin (Stripe redirects, share links).
- `DEMO_MODE` (default true) — simulated vendor SMS replies 5–20 s after a request; enables `/api/demo/*`.
- `LLM_PROVIDER` = `anthropic` | `emergent` | `mock` (auto: anthropic if `ANTHROPIC_API_KEY`, else emergent if `EMERGENT_LLM_KEY`, else mock).
  `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- `MONGODB_AI_API_KEY`, `MONGODB_AI_ENDPOINT`, `EMBEDDING_MODEL` — Voyage embeddings via MongoDB.
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` — test mode only.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — simulated if any is missing. `TWILIO_WEBHOOK_URL` = the public webhook URL (signature check).
- `MAPBOX_TOKEN` — public `pk.` token, served to the browser via `/api/config`. Missing → OpenStreetMap 2D.
- `STEP_DELAY` (seconds between visible agent steps, default 0.9; tests use 0), `SIM_REPLY_MIN/MAX`.

Frontend (`frontend/.env`): `REACT_APP_BACKEND_URL` (Emergent sets it). Vite reads `REACT_APP_*` via `envPrefix`.

## Deploying on Emergent

- Structure matches Emergent: `backend/server.py` (`uvicorn server:app --port 8001`), all routes under `/api`,
  `frontend` runs with `yarn start` on :3000 and builds to `frontend/build`.
- Set in Emergent: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`, plus any integration keys above.
- To use Emergent's Universal LLM Key: set `LLM_PROVIDER=emergent` and `EMERGENT_LLM_KEY=...`, and install
  `emergentintegrations` (`pip install emergentintegrations --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/`).
  The provider code is `_emergent_call` in `backend/ai/llm.py`.
- Stripe webhook endpoint: `POST {backend}/api/webhooks/stripe`, event `checkout.session.completed`.
  Twilio inbound webhook: `POST {backend}/api/webhooks/twilio`.

## Conventions

- Every outbound action (message, booking, payment, submission) goes through `agents/approval.py`
  (`request_approval` → user approves → `run_gated`). Never call `services.sms.send_sms` or Stripe outside a gate handler.
- Every agent action writes an `agent_steps` doc via `agents/steps.py` (published live over SSE `/api/stream`).
- Every model call goes through `ai/llm.py` with a deterministic `fallback`, and returns a Pydantic model.
- Outbound text must include the AI disclosure (`services.sms.disclose`). No SSNs/IDs/bank numbers/passwords stored.
- Prices/values are ranges labeled "estimate based on similar items". Lease summaries: "For your review, not legal advice."
- Mongo docs use string `_id` (uuid hex); `core.db.to_json` converts to `id` and strips `embedding`, `data`, `password_hash`.
  Don't name a response field `data` — it gets stripped (receipt metadata lives in `receipt.meta`).
- Dates are ISO `YYYY-MM-DD` strings; timestamps are UTC datetimes.
- Item names mid-sentence use `agents.steps.nm(item)` (keeps "TV", '43"').

## Sandbox notes (Claude Code cloud)

- Only package registries are reachable; Stripe, Voyage (ai.mongodb.com), Mapbox and Anthropic API calls fail here,
  so the app runs on its fallbacks. No Mongo server — use `MONGO_URL=mongomock://local`.
- Playwright: `require('playwright')` with the preinstalled Chromium; don't run `playwright install`.
