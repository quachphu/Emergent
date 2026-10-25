"""Embeddings: Voyage AI via MongoDB (`ai.mongodb.com`), with a deterministic local fallback.

Each stored embedding records its model, so vectors from different models are never compared.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import time

import httpx

from core.config import get_settings

log = logging.getLogger("handoff.embeddings")

FALLBACK_MODEL = "local-hash-2048"
FALLBACK_DIM = 2048
_down_until = 0.0

# Small synonym map so the offline fallback still matches "desk" with "writing table", etc.
SYNONYMS = {
    "desk": ["desk", "workstation"],
    "table": ["table", "surface"],
    "chair": ["chair", "seat"],
    "sofa": ["sofa", "couch", "seating"],
    "couch": ["couch", "sofa", "seating"],
    "loveseat": ["couch", "sofa", "seating"],
    "bed": ["bed", "sleep"],
    "mattress": ["mattress", "sleep"],
    "lamp": ["lamp", "light"],
    "light": ["lamp", "light"],
    "tv": ["tv", "television"],
    "television": ["tv", "television"],
    "monitor": ["monitor", "display"],
    "bookshelf": ["bookshelf", "shelf", "bookcase"],
    "bookcase": ["bookshelf", "shelf", "bookcase"],
    "shelf": ["shelf", "bookshelf"],
    "rug": ["rug", "carpet"],
    "plant": ["plant", "greenery", "houseplant"],
    "greenery": ["plant", "greenery"],
    "monstera": ["plant", "monstera", "houseplant"],
    "book": ["books"],
    "microwave": ["microwave"],
    "bike": ["bike", "bicycle"],
    "bicycle": ["bike", "bicycle"],
    "dresser": ["dresser", "drawers"],
}
STOPWORDS = {
    "for",
    "a",
    "an",
    "the",
    "and",
    "or",
    "my",
    "to",
    "of",
    "in",
    "with",
    "need",
    "needs",
    "want",
    "looking",
    "any",
    "some",
    "just",
    "is",
    "it",
    "me",
    "i",
}

_WORD = re.compile(r"[a-z]+")


def _tokens(text: str) -> list[str]:
    words = _WORD.findall(text.lower())
    out: list[str] = []
    for w in words:
        if len(w) < 2 or w in STOPWORDS:
            continue
        stem = w[:-1] if w.endswith("s") and len(w) > 3 else w
        out.extend(SYNONYMS.get(stem, SYNONYMS.get(w, [stem])))
    return out


def local_embedding(text: str) -> list[float]:
    vec = [0.0] * FALLBACK_DIM
    for tok in _tokens(text):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % FALLBACK_DIM] += 1.0 if (h >> 8) & 1 else 0.9
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def status() -> dict:
    s = get_settings()
    live = bool(s.mongodb_ai_api_key) and time.time() >= _down_until
    return {"provider": "voyage" if s.mongodb_ai_api_key else "local", "live": live, "model": s.embedding_model}


async def embed(texts: list[str], input_type: str) -> tuple[list[list[float]], str]:
    """Return (vectors, model_name). input_type is "document" for items, "query" for needs."""
    global _down_until
    s = get_settings()
    if s.mongodb_ai_api_key and time.time() >= _down_until and texts:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    s.mongodb_ai_endpoint,
                    headers={"Authorization": f"Bearer {s.mongodb_ai_api_key}"},
                    json={"input": texts, "model": s.embedding_model, "input_type": input_type},
                )
                resp.raise_for_status()
                data = resp.json()["data"]
                vectors = [d["embedding"] for d in sorted(data, key=lambda d: d.get("index", 0))]
                return vectors, s.embedding_model
        except Exception as exc:  # noqa: BLE001
            log.warning("voyage embeddings unavailable (%s); using local fallback", type(exc).__name__)
            _down_until = time.time() + 120
    return [local_embedding(t) for t in texts], FALLBACK_MODEL


async def embed_one(text: str, input_type: str) -> tuple[list[float], str]:
    vectors, model = await embed([text], input_type)
    return vectors[0], model
