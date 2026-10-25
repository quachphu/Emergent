# Handoff — your move, on autopilot

**Handoff is an AI relocation autopilot.** Relocating means running five jobs at once. Handoff plans all five
backward from move day, does the legwork with AI agents, and shows every step it takes. You approve anything
that commits you; you alone handle signatures, IDs and banking.

| Lane | What Handoff does |
|------|-------------------|
| 📦 Stuff | Scan rooms (upload, webcam or phone QR) → item cards with value ranges → keep/let-go deck → sell, hand off to arrivals, donate, recycle, free city pickup or haul |
| 🚚 Transport | One bundled job texted to local haulers/movers, replies parsed into quote cards, booked and paid with Stripe (test mode); car: sell or ship |
| 🔑 Old home | Notice-to-vacate letter (you sign), timestamped move-out photos, keys, 21-day deposit countdown + follow-up letter |
| 🏠 New home | Lease PDF → plain-language summary with flagged clauses and questions (for your review, not legal advice), application packet, utilities and internet dates |
| 🗂️ Admin & money | Dated checklist: USPS forwarding, DMV, voter registration, employer, bank, subscriptions — drafted emails and official links |

Every outbound action (message, booking, payment, submission) waits for your approval, and every agent step is
shown live with a "why" line and a receipt.

## Stack

- **Frontend:** React + TypeScript (Vite), Tailwind CSS, shadcn-style Radix components, lucide-react, framer-motion,
  TanStack Query, Mapbox GL JS (3D fly-through) and Leaflet (2D maps), cmdk (⌘K).
- **Backend:** FastAPI, Pydantic, Motor (MongoDB), Server-Sent Events for the live step feed.
- **AI:** `backend/ai/llm.py` — Anthropic Claude by default (`vision_json`, `text_json`, strict JSON validated with
  Pydantic, retry once), switchable to Emergent's Universal LLM Key. Voyage `voyage-4-lite` embeddings via
  MongoDB's `ai.mongodb.com` for matching.
- **Integrations:** Stripe Checkout (test mode), Twilio SMS, Mapbox. Each has a fallback (see below).

## Quick start

```bash
# Backend — http://localhost:8001
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env        # MONGO_URL=mongomock://local works with no database (in-memory, demo auto-seeds)
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --reload --timeout-graceful-shutdown 3

# Frontend — http://localhost:3000 (proxies /api to :8001)
cd frontend
yarn install
yarn start
```

Open http://localhost:3000 and click **Try the demo as Maya**, or create an account and set up your own move.

### Seed the demo into a real MongoDB

```bash
cd backend && .venv/bin/python seed.py      # Maya: maya@handoff.demo / handoff-demo
```

**Reset demo** (Settings) and **Try the demo** (login page) restore the same data via `POST /api/demo/reset`
(only when `DEMO_MODE=true`).

## Environment variables

`backend/.env` (see `backend/.env.example` — names only, never commit values):

| Variable | Purpose |
|----------|---------|
| `MONGO_URL`, `DB_NAME` | MongoDB connection (Emergent standard names). `mongomock://local` = in-memory |
| `CORS_ORIGINS` | Comma-separated allowed origins (`*` in dev) |
| `JWT_SECRET` | Session signing secret — **required in production** |
| `FRONTEND_URL` | Public frontend origin (share links, Stripe redirects, phone capture) |
| `DEMO_MODE` | `true` (default): simulated vendor replies 5–20 s after a request, demo reset endpoint |
| `LLM_PROVIDER` | `anthropic` \| `emergent` \| `mock` (auto-detected from keys) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude (default model `claude-opus-5-5`) |
| `EMERGENT_LLM_KEY` | Emergent Universal LLM Key (with `LLM_PROVIDER=emergent`) |
| `MONGODB_AI_API_KEY`, `MONGODB_AI_ENDPOINT`, `EMBEDDING_MODEL` | Voyage embeddings via MongoDB |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe test mode |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WEBHOOK_URL` | SMS (simulated if any is missing) |
| `MAPBOX_TOKEN` | Public `pk.` token, served to the browser via `/api/config` |

`frontend/.env`: `REACT_APP_BACKEND_URL` (leave empty locally to use the dev proxy; Emergent sets it).

### Fallbacks

| Service | Without it |
|---------|------------|
| LLM | Deterministic rules: catalog-based recognizer (file names/hints), keep-or-let-go rules, regex quote parser, clause scanner for leases. Cards say "Check name" so you can edit |
| Embeddings | Local hashed bag-of-words with synonyms |
| Stripe | In-app simulated test checkout that runs the same paid handler as the webhook |
| Twilio | Messages are logged and marked simulated; DEMO_MODE simulates replies |
| Mapbox | OpenStreetMap 2D map; a schematic route if no tiles load |

Settings → Integrations shows which are live.

### Webhooks

- Stripe: `POST {backend}/api/webhooks/stripe` (event `checkout.session.completed`). Payments also confirm on return
  from Checkout (`/api/bookings/{id}/confirm`), so local development works without a webhook.
- Twilio inbound SMS: `POST {backend}/api/webhooks/twilio` (signature verified).

## Demo script (≈ 2 minutes)

1. **Login → Try the demo as Maya.** Command Center: 12 days to move, Long Beach → San Francisco, five lane rings,
   Today, money panel. Click **Fly-through** for the 3D map, then **Skip**.
2. **Stuff → Scan → Try sample photos.** A chair and a table become item cards with value ranges and reasons.
   **Review** to swipe (← let go, → keep).
3. **Ask Handoff for a plan.** "Here's what I'll do": list the desk, offer the chair to arrivals, book a city pickup
   for the mattress, get haul quotes for the rest, draft the notice, summarize the lease. Edit or remove, then
   **Approve plan** and watch each step run live with receipts.
4. Approve the waiting steps (price schedule, offers, pickup submission, texts to haulers). The chair matches an
   incoming new grad who accepts a pickup window.
5. **Transport:** three hauler quotes arrive side by side → **Book with Stripe** → approve → pay with
   `4242 4242 4242 4242` → booked, receipt in the timeline, vendor notified.
6. **Old home:** notice letter ready to sign. **New home:** lease summary with flagged clauses.
7. **Command Center:** 70%+ resolved, money earned and spent, impact card, every step visible.

## Tests and checks

```bash
cd backend && STEP_DELAY=0 .venv/bin/python -m pytest -q     # approval gate, rules, scheduling, Stripe webhook,
                                                              # quote parsing, scan, matching, homes, full demo story
.venv/bin/ruff check . && .venv/bin/ruff format --check .
cd frontend && yarn typecheck && yarn lint && yarn build
yarn e2e                                                      # Playwright smoke test of the demo story
```

## Deploying on Emergent

The repo follows Emergent's layout: `backend/server.py` (`uvicorn server:app --port 8001`, all routes under `/api`),
`frontend` started with `yarn start` on port 3000 and built into `frontend/build`, `MONGO_URL` / `DB_NAME` /
`REACT_APP_BACKEND_URL`. Import the GitHub repo into Emergent and set the environment variables above. To use the
Universal LLM Key, set `LLM_PROVIDER=emergent` and `EMERGENT_LLM_KEY`, and install `emergentintegrations` (see
`CLAUDE.md`).

## Safety rules built in

- Never collects SSNs, government ID numbers, bank account numbers or passwords for other services (notices where
  people might be tempted).
- Never signs for you; documents are routed for your own signature.
- Every outbound message says it was sent by an AI assistant on your behalf.
- No automated posting to Facebook Marketplace, Craigslist or OfferUp — Copy listing and Open site buttons instead.
- No payments for item sales; buyers pay in person. Stripe is only used to book haulers and movers.
- Values are ranges labeled "estimate based on similar items". Lease summaries are "for your review, not legal advice".
