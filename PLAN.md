# Handoff — Build Plan

Source of truth for the product is the handoff spec (summarized in `CLAUDE.md`). This file tracks
structure, decisions and per-phase progress.

## Decisions (made without blocking)

| # | Decision | Why |
|---|----------|-----|
| D1 | Repo was empty → `frontend/` (React) + `backend/` (FastAPI) at root, every route under `/api`. | Spec §2 + Emergent conventions. |
| D2 | Frontend is **Vite + React + TypeScript**, but keeps Emergent's contract: `yarn start` serves on port 3000, `yarn build` outputs to `frontend/build`, backend URL comes from `REACT_APP_BACKEND_URL`. | TS + fast builds while staying drop-in compatible with Emergent's CRA-style supervisor. |
| D3 | Backend env names follow Emergent: `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`; server entry `backend/server.py` → `uvicorn server:app --port 8001`. | Emergent import. |
| D4 | `MONGO_URL=mongomock://local` runs an in-memory Mongo (mongomock-motor) for tests and sandboxed dev. Real MongoDB is used for everything else. | No Mongo server in the build sandbox. |
| D5 | Live step feed = backend publishes every `agent_steps` write to an in-process broker → SSE (`/api/stream`). Change streams are not required (they need a replica set). | Works on every Mongo deployment. |
| D6 | Vector search: cosine similarity in Python over stored embeddings (Atlas Vector Search optional, not required). Embeddings from Voyage (`voyage-4-lite`) via `ai.mongodb.com`; fallback = deterministic hashed bag-of-words with synonym expansion. Each embedding stores its model name; mismatches are re-embedded. | Works without Atlas; graceful fallback. |
| D7 | `backend/ai/llm.py` providers: `anthropic` (default when `ANTHROPIC_API_KEY` set), `emergent` (Universal LLM Key via `emergentintegrations`), `mock`. Every call takes a `fallback` callable so each agent has a deterministic answer when the model is unavailable. | Swappable + demo works offline. |
| D8 | Files (scan photos, item photos, lease PDFs, receipts) are stored in MongoDB (`files` collection, downscaled JPEG) and served from `/api/files/{id}`. | No dependence on container disk (Emergent pods are ephemeral). |
| D9 | Stripe: real Checkout Session when `STRIPE_SECRET_KEY` is set and reachable; on return the backend also verifies the session (`/api/bookings/{id}/confirm`) so bookings complete even without a webhook in dev. Without Stripe → in-app **simulated checkout** that runs the same idempotent `mark_booking_paid` handler. Connect payouts: `services/payouts.py` stub interface only. | Robust demo; spec forbids Connect for now. |
| D10 | Twilio via REST (httpx), simulated when any var missing. DEMO_MODE replies route through the same inbound handler as the real webhook. | One code path. |
| D11 | Mapbox token (public `pk.`) is read by the backend from `MAPBOX_TOKEN` and exposed via `/api/config` (it's a publishable token). Geocoding: Mapbox if available, else a built-in gazetteer of CA cities/neighborhoods + deterministic jitter. | One env var; offline fallback. |
| D12 | Pickup lead time: planner books 14 days before pickup when possible; if move day is closer, the task is due today and flagged "tight", pickup = today + city lead time. | Spec "book ≥14 days ahead" vs 12-day demo. |
| D13 | Approval gate (`agents/approval.py`) is the only way to run outbound actions: `request()` creates a `waiting_for_user` step holding an action; `approve()` executes the registered handler. Handlers refuse to run unless their step is approved. | Spec §5. |
| D14 | Auth: bcrypt hashes + JWT bearer token (localStorage). SSE uses `?token=` because EventSource can't set headers. | Simple, works behind Emergent ingress. |

## File structure

```
backend/
  server.py                 FastAPI app, mounts routers under /api, startup indexes
  core/config.py            env settings (never logs secrets)
  core/db.py                Motor / mongomock client, indexes, id helpers
  core/security.py          bcrypt, JWT
  core/deps.py              current_user, current_move
  core/events.py            in-process pub/sub → SSE
  core/files.py             store/serve images & PDFs in Mongo
  models/schemas.py         Pydantic models + enums
  ai/llm.py                 vision_json / text_json, provider switch, retry-once JSON validation
  ai/embeddings.py          Voyage via ai.mongodb.com + hashed fallback, cosine
  agents/steps.py           record/update agent_steps (+publish)
  agents/approval.py        approval gate
  agents/orchestrator.py    backward schedule (5 lanes) + plan proposal + run executor
  agents/vision_inventory.py
  agents/keep_or_let_go.py
  agents/listing_pricing.py
  agents/matchmaker.py
  agents/pickup_booker.py
  agents/vendor_outreach.py
  agents/paperwork.py       notice letter, lease summary, admin drafts, deposit letter
  agents/car.py
  services/geo.py, sms.py, stripe_service.py, payouts.py
  data/catalog.py           item catalog (values, sizes, weights) for fallbacks
  data/city_rules.py        SF + Long Beach rules
  data/demo.py              Maya seed
  routes/*.py               auth, config, moves, items, scan, tasks, steps, runs, listings, needs,
                            transport, documents, home, admin, inbox, demo, stream, webhooks, files
  seed.py                   CLI: python seed.py
  tests/                    pytest
frontend/
  src/lib                   api client, query hooks, sse, format, theme
  src/components/ui         shadcn-style primitives (Radix)
  src/components            AppShell, Sidebar, TopBar, CommandPalette, SidePanel, LaneCard, ItemCard,
                            TaskRow, StepTimeline, QuoteCard, MoneyPanel, Countdown, MapHero,
                            EmptyState, ProgressRing, Skeletons
  src/pages                 Auth, Setup, Flythrough, CommandCenter, Stuff (Scan/Review/Items),
                            Transport, OldHome, NewHome, Admin, Map, Vault, Inbox, Settings,
                            Run, Handoff board, PublicListing, PhoneCapture, Checkout(sim)
  e2e/demo.spec.ts          Playwright smoke test
```

## Data model

Collections exactly as spec §4 (`users, moves, rooms, items, tasks, listings, needs, matches, vendors,
jobs, quotes, bookings, city_rules, documents, agent_steps, scan_media`) plus:
- `files` (binary blobs: content_type, data, size, move_id)
- `runs` (move_id, status `proposed|running|paused|done`, actions[] {id, kind, title, detail, params, enabled})
- `messages` (move_id, direction, channel, to/from, body, related ids) — the inbox log
- `capture_tokens` (phone capture QR links)

Extra fields: `tasks.key` (stable id for replanning), `tasks.notes/flag`, `agent_steps.run_id/action/undo`,
`items.weight_lbs/status/handled_by`, `embedding_model`.
Indexes: 2dsphere on items/vendors/needs `location`; TTL on `scan_media.expire_at`; unique `users.email`,
`listings.public_slug`, `tasks(move_id,key)`.

## API routes (all under `/api`)

| Area | Routes |
|------|--------|
| Health/config | `GET /health`, `GET /config` (public keys + integration status) |
| Auth | `POST /auth/signup`, `POST /auth/login`, `GET /auth/me` |
| Move | `POST /moves`, `GET /moves/current`, `PATCH /moves/current`, `GET /moves/current/summary` (countdown, lanes, today, inbox count, money, impact), `POST /geo/geocode` |
| Stuff | `GET/POST /rooms`, `POST /scan/upload`, `POST /scan/capture-link`, `POST /public/capture/{token}`, `POST /scan/analyze`, `GET/PATCH/DELETE /items/{id}`, `POST /items/{id}/decide`, `POST /items/decide-all`, `POST /inventory/confirm` |
| Plan | `GET /tasks?lane=`, `PATCH /tasks/{id}`, `POST /plan/replan` |
| Runs/steps | `POST /runs/propose`, `GET /runs/current`, `PATCH /runs/{id}/actions/{aid}`, `POST /runs/{id}/approve`, `POST /runs/{id}/pause|resume`, `GET /steps`, `POST /steps/{id}/approve|reject|retry|undo|takeover` |
| Stream | `GET /stream?token=` (SSE) |
| Sell | `GET /listings`, `POST /items/{id}/listing`, `PATCH /listings/{id}`, `POST /listings/{id}/sold`, `GET /public/listings/{slug}`, `POST /public/listings/{slug}/interest`, `POST /listings/{id}/interest/{rid}/accept` |
| Handoff | `GET /public/needs`, `POST /public/needs`, `GET /matches`, `POST /matches/run`, `POST /matches/{id}/offer`, `POST /public/matches/{id}/accept` |
| Transport | `GET /city-rules`, `GET /vendors`, `POST /jobs` (haul/mover/auto), `GET /jobs`, `POST /jobs/{id}/send`, `GET /quotes`, `POST /quotes/{id}/book`, `POST /bookings/{id}/confirm`, `POST /bookings/{id}/simulate-pay`, `POST /webhooks/stripe`, `POST /webhooks/twilio` |
| Homes/admin | `POST /documents` (upload), `GET /documents`, `POST /documents/{id}/summarize`, `POST /documents/sample-lease`, `GET /old-home`, `POST /old-home/notice`, `POST /old-home/photos`, `GET /new-home`, `GET /admin/checklist`, `POST /car/analyze`, `PATCH /car` |
| Demo | `POST /demo/reset` (seed Maya + log in), `GET /inbox` |

## Phase checklist

### Phase 1 — Foundation, design system, Command Center
- [x] Backend core (config, db, auth, move setup, geocoding, summary)
- [x] Design tokens (light/dark), fonts, Tailwind theme, shadcn-style primitives
- [x] AppShell: sidebar, top bar, ⌘K palette, right side panel, mobile tab bar + sheet
- [x] Signup/login, setup wizard (with geocoding), Command Center (countdown, lane rings, Today ≤3, inbox, money)
- [x] Done when: new user sets up in < 2 min and lands on a polished, populated Command Center (scripted run: 3.8 s; wizard has "Fill example")

### Phase 2 — 3D map onboarding + Map page
- [x] Mapbox 3D fly-through (Standard style 3D buildings, pitch/bearing choreography, orange route, distance, days left, commute), Skip
- [x] Fallback to 2D Leaflet without token / WebGL / with reduced motion / if the style fails to load; schematic route until tiles load
- [x] Map page with filterable pins (sale items, matched arrivals, donation sites, vendors) — `GET /api/map/pins`
- Verified in sandbox: Mapbox initializes, style request is blocked by the network → 2D → schematic; Skip works in both modes.

### Phase 3 — Scan and decide
- [x] Upload / drag-drop per room, webcam capture, QR phone capture with live desktop updates (SSE `scan_media` events)
- [x] Vision → items (all fields), edit/delete (side panel)
- [x] Review deck (swipe + ←/→, Enter = suggestion), keep-or-let-go rules (no SELL < 5 days; HANDOFF over DONATE when a need matches)
- [x] Done when: `tests/test_scan.py` — dining chair + dining table photos → correct item cards with value ranges and reasons
- Note: without an AI key the offline recognizer matches file names/hints against `data/catalog.py`; cards show "Check name".
- Demo photos are illustrations generated for this repo (`backend/data/demo_photos`, `frontend/public/samples`).
- SSE streams end on shutdown (uvicorn `handle_exit` hook) so `--reload` doesn't hang.

### Phase 4 — Plan + visible agent steps
- [ ] Backward scheduler for 5 lanes, replan on change + app load
- [ ] Lane pages: table + board views
- [ ] Plan preview (approve / edit / remove), live SSE step timeline with states, why, receipts, pause/undo/take over/retry

### Phase 5 — Sell and Handoff
- [ ] Listings + approved price schedule, public item page, interest requests, Copy listing / Open Marketplace
- [ ] Handoff board, embeddings, matching (similarity + city + dates), both sides accept a pickup window

### Phase 6 — Transport + Stripe
- [ ] City rules (SF, Long Beach) with steps, lead time, night-before reminders
- [ ] HAUL bundle → gated SMS → (simulated) replies → parsed quote cards
- [ ] Stripe Checkout (test) + webhook → booking paid, receipt in timeline, vendor notified, money panel
- [ ] Mover request using the inventory

### Phase 7 — Old home, new home, car, admin, vault
- [ ] Notice letter, move-out photo checklist, deposit countdown (21 days CA) + follow-up letter
- [ ] Lease PDF → text → summary + flags + questions; application checklist; utilities/internet; renters insurance
- [ ] Car: photo estimate, sell or ship paths
- [ ] Admin dated checklist with official links + drafted emails
- [ ] Vault with expiry reminders

### Phase 8 — Demo, polish, hardening
- [ ] Seed (Maya, 14 items, 10 needs, 6 vendors, city rules), Reset demo button
- [ ] Impact card; empty states, skeletons, toasts, retryable errors; mobile + dark passes
- [ ] README, Playwright smoke test of the demo story

## Status log
- Phase 1 done. Backend for all phases scaffolded up front (agents, gate, routes, seed) with 19 pytest tests; frontend shell,
  auth, setup wizard and Command Center built. Sandbox can't reach Stripe/Voyage/Mapbox/Anthropic, so fallbacks were exercised.
- Decision D15: "resolved %" = (tasks due by move day that are done + items with a plan in motion) / (those tasks + items).
- Decision D16: Spec seeds "10 arrival needs in San Francisco", but Maya's let-go items are in Long Beach and pickups are local,
  so matching requires the same city. Seed: 7 needs in Long Beach (people arriving where Maya leaves) + 3 in San Francisco.
- Phase 2 done.
- Phase 3 done.
