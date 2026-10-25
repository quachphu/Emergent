"""In-process pub/sub. Every agent step / item / quote change is published here and streamed over SSE."""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from .db import to_json

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(move_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers[move_id].add(q)
    return q


def unsubscribe(move_id: str, q: asyncio.Queue) -> None:
    _subscribers[move_id].discard(q)


def publish(move_id: str, kind: str, data: Any = None) -> None:
    if not move_id:
        return
    message = json.dumps({"type": kind, "data": to_json(data)}, default=str)
    for q in list(_subscribers.get(move_id, ())):
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            pass


def subscriber_count(move_id: str) -> int:
    return len(_subscribers.get(move_id, ()))
