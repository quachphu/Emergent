"""MongoDB access (Motor). `MONGO_URL=mongomock://...` uses an in-memory database for tests/sandbox."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime
from typing import Any

from .config import get_settings

log = logging.getLogger("handoff.db")

_client: Any = None
_db: Any = None


def _make_client(url: str):
    if url.startswith("mongomock://"):
        from mongomock_motor import AsyncMongoMockClient

        return AsyncMongoMockClient(tz_aware=True)
    from motor.motor_asyncio import AsyncIOMotorClient

    return AsyncIOMotorClient(url, tz_aware=True, serverSelectionTimeoutMS=8000)


def get_db():
    global _client, _db
    if _db is None:
        s = get_settings()
        _client = _make_client(s.mongo_url)
        _db = _client[s.db_name]
    return _db


def reset_db():
    """Drop the cached client (tests create a fresh in-memory DB each time)."""
    global _client, _db
    _client = None
    _db = None
    return get_db()


def is_mock() -> bool:
    return get_settings().mongo_url.startswith("mongomock://")


async def ensure_indexes() -> None:
    db = get_db()
    specs: list[tuple[str, Any, dict]] = [
        ("users", "email", {"unique": True}),
        ("moves", "user_id", {}),
        ("items", "move_id", {}),
        ("tasks", [("move_id", 1), ("key", 1)], {"unique": True}),
        ("agent_steps", [("move_id", 1), ("created_at", -1)], {}),
        ("listings", "public_slug", {"unique": True, "sparse": True}),
        ("quotes", "job_id", {}),
        ("scan_media", "expire_at", {"expireAfterSeconds": 0}),
        ("items", [("location", "2dsphere")], {}),
        ("vendors", [("location", "2dsphere")], {}),
        ("needs", [("location", "2dsphere")], {}),
    ]
    for coll, keys, opts in specs:
        try:
            await db[coll].create_index(keys, **opts)
        except Exception as exc:  # mongomock lacks some index types
            log.info("index %s.%s skipped: %s", coll, keys, type(exc).__name__)


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def to_json(value: Any) -> Any:
    """Make Mongo documents JSON-safe: `_id` → `id`, datetimes → ISO, drop embeddings and blobs."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k == "_id":
                out["id"] = str(v)
                continue
            if k in {"embedding", "data", "password_hash"}:
                continue
            out[k] = to_json(v)
        return out
    if isinstance(value, list):
        return [to_json(v) for v in value]
    if isinstance(value, datetime):
        return as_utc(value).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, bytes):
        return None
    return value


async def insert(coll: str, doc: dict) -> dict:
    doc = dict(doc)
    doc.setdefault("_id", new_id())
    doc.setdefault("created_at", now())
    await get_db()[coll].insert_one(doc)
    return doc
