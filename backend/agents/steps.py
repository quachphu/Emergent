"""Every agent action is written to `agent_steps` and published to the live feed."""

from __future__ import annotations

import asyncio

from core.config import get_settings
from core.db import get_db, insert, new_id, now
from core.events import publish


async def pace(multiplier: float = 1.0) -> None:
    """Small pause so steps are visibly live in the UI (0 in tests)."""
    delay = get_settings().step_delay * multiplier
    if delay > 0:
        await asyncio.sleep(delay)


async def create_step(
    move_id: str,
    lane: str,
    title: str,
    *,
    state: str = "planned",
    reason: str = "",
    task_id: str | None = None,
    run_id: str | None = None,
    action_id: str | None = None,
    receipt: dict | None = None,
    order: int | None = None,
    agent: str = "orchestrator",
) -> dict:
    doc = await insert(
        "agent_steps",
        {
            "_id": new_id(),
            "move_id": move_id,
            "lane": lane,
            "task_id": task_id,
            "run_id": run_id,
            "action_id": action_id,
            "agent": agent,
            "title": title,
            "state": state,
            "reason": reason,
            "receipt": receipt,
            "gate": None,
            "undo": None,
            "order": order if order is not None else int(now().timestamp() * 1000),
            "updated_at": now(),
        },
    )
    publish(move_id, "step", doc)
    return doc


async def update_step(step_id: str, **fields) -> dict | None:
    fields["updated_at"] = now()
    db = get_db()
    await db.agent_steps.update_one({"_id": step_id}, {"$set": fields})
    doc = await db.agent_steps.find_one({"_id": step_id})
    if doc:
        publish(doc["move_id"], "step", doc)
    return doc


async def start(step: dict) -> dict:
    return await update_step(step["_id"], state="running")


async def finish(step: dict, receipt: dict | None = None, **extra) -> dict:
    fields = {"state": "done", **extra}
    if receipt is not None:
        fields["receipt"] = receipt
    return await update_step(step["_id"], **fields)


async def fail(step: dict, error: str) -> dict:
    return await update_step(step["_id"], state="failed", error=error)


async def quick(move_id: str, lane: str, title: str, *, reason: str = "", receipt: dict | None = None, **kw) -> dict:
    """Create a step, show it running briefly, then mark it done with a receipt."""
    step = await create_step(move_id, lane, title, state="running", reason=reason, **kw)
    await pace()
    return await finish(step, receipt)


def receipt(kind: str, text: str, *, amount: float | None = None, url: str | None = None, image: str | None = None, data: dict | None = None) -> dict:
    out: dict = {"kind": kind, "text": text}
    if amount is not None:
        out["amount"] = amount
    if url:
        out["url"] = url
    if image:
        out["image"] = image
    if data:
        out["meta"] = data
    return out


def nm(item_or_name) -> str:
    """Item name for use mid-sentence: lowercase words, but keep acronyms/sizes like TV or 43"."""
    name = item_or_name.get("name", "") if isinstance(item_or_name, dict) else str(item_or_name)
    return " ".join(w if (w.isupper() and len(w) > 1) or any(c.isdigit() for c in w) else w.lower() for w in name.split())
