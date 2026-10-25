"""Handoff API. Run: uvicorn server:app --host 0.0.0.0 --port 8001 --reload"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agents import approval, booking, listing_pricing, matchmaker, pickup_booker, vendor_outreach  # noqa: F401  (register gate handlers)
from core.config import get_settings
from core.db import ensure_indexes, get_db
from routes import auth, config, demo, files, home, mapview, moves, plan, sell, stuff, transport

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("handoff")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    await ensure_indexes()
    if s.jwt_secret == "dev-insecure-secret" and not s.mongo_url.startswith("mongomock"):
        log.warning("JWT_SECRET is not set — set it before deploying (sessions use a development secret).")
    log.info("handoff api ready (db=%s, llm=%s, demo_mode=%s)", "mock" if s.mongo_url.startswith("mongomock") else "mongodb", s.llm_provider, s.demo_mode)
    if s.demo_mode and s.mongo_url.startswith("mongomock") and not await get_db().users.find_one({}):
        from data.demo import seed

        await seed()
        log.info("in-memory database: demo seeded")
    yield


app = FastAPI(title="Handoff API", lifespan=lifespan)

api_router = APIRouter(prefix="/api")
for r in (config, auth, moves, stuff, plan, sell, transport, home, mapview, demo, files):
    api_router.include_router(r.router)
app.include_router(api_router)

s = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=s.cors_origins or ["*"],
    allow_credentials="*" not in s.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "input"
    return JSONResponse(status_code=422, content={"detail": f"Check {field}: {first.get('msg', 'invalid value')}", "errors": exc.errors()})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Try again."})
