"""Vision inventory: photos → items with every item field."""

from __future__ import annotations

import asyncio
import logging

from ai.llm import Image, vision_json
from core.db import get_db, insert, now
from core.events import publish
from core.files import file_b64, file_url, store_file
from data.catalog import match
from models.schemas import VisionItem, VisionResult

from . import steps
from .keep_or_let_go import decide
from .matchmaker import best_match_for_item, ensure_item_embedding
from .schedule import days_left
from .steps import nm

log = logging.getLogger("handoff.vision")

PROMPT = (
    "You are cataloging a home before a move. List each distinct household item in this photo that someone would "
    "decide to keep, sell, give away or dispose of (furniture, electronics, appliances, decor, boxes). Ignore walls, "
    "windows and built-ins. For each item give: a short name (e.g. 'Office chair'), category (Furniture, Bedroom, "
    "Electronics, Kitchen, Lighting, Decor, Books, Sports, Other), brand_guess if visible or likely (else null), "
    "condition 1-5 (5 = like new), size S/M/L/XL, dims_estimate in inches, resale_low/high (used-market USD estimate "
    "for the area), move_cost_estimate (USD to move it locally), replacement_cost_estimate (USD new), weight_lbs, "
    "confidence 0-1. At most 6 items."
)


def fallback_items(name: str, hint: str) -> VisionResult:
    row = match(f"{hint} {name}")
    if not row:
        return VisionResult(
            items=[
                VisionItem(
                    name=hint.strip().capitalize() if hint.strip() else "Unidentified item",
                    category="Other",
                    brand_guess=None,
                    condition=3,
                    size="M",
                    dims_estimate="unknown",
                    resale_low=5,
                    resale_high=25,
                    move_cost_estimate=20,
                    replacement_cost_estimate=60,
                    weight_lbs=20,
                    confidence=0.2,
                )
            ]
        )
    return VisionResult(
        items=[
            VisionItem(
                name=row["name"],
                category=row["category"],
                brand_guess=None,
                condition=4 if "new" in hint.lower() else 3,
                size=row["size"],
                dims_estimate=row["dims_estimate"],
                resale_low=row["resale_low"],
                resale_high=row["resale_high"],
                move_cost_estimate=row["move_cost_estimate"],
                replacement_cost_estimate=row["replacement_cost_estimate"],
                weight_lbs=row["weight_lbs"],
                confidence=0.55,
            )
        ]
    )


async def _analyze_one(media: dict, hint: str) -> tuple[VisionResult, str]:
    b64 = await file_b64(media["file_id"])
    if not b64:
        return VisionResult(items=[]), "fallback"
    data, ctype = b64
    result = await vision_json(
        [Image(data_b64=data, media_type=ctype, name=media.get("name", ""))],
        VisionResult,
        PROMPT + (f"\nThe owner says: {hint}" if hint else ""),
        fallback=lambda: fallback_items(media.get("name", ""), hint or media.get("hint", "")),
    )
    return result.value, result.source


async def suggest_decision(item: dict, move: dict, *, allow_keep: bool = True) -> tuple[str, str]:
    need, _ = await best_match_for_item(item, move)
    decision, reason, _ = await decide(
        item,
        days_left(move["move_date"]),
        has_match=need is not None,
        priorities=move.get("priorities"),
        move_method=move.get("move_method", "movers"),
        allow_keep=allow_keep,
    )
    return decision, reason


async def analyze(move: dict, media_ids: list[str], room_id: str | None = None, hint: str = "") -> list[dict]:
    db = get_db()
    media = [m async for m in db.scan_media.find({"_id": {"$in": media_ids}, "move_id": move["_id"], "analyzed": {"$ne": True}})]
    if not media:
        return []
    room = await db.rooms.find_one({"_id": room_id}) if room_id else None
    where = f" in the {nm(room)}" if room else ""
    st = await steps.create_step(
        move["_id"],
        "stuff",
        f"Look at {len(media)} photo{'s' if len(media) != 1 else ''}{where}",
        state="running",
        reason="Vision model identifies items, condition and value ranges.",
        agent="vision",
    )
    sem = asyncio.Semaphore(3)

    async def run(m):
        async with sem:
            return m, *(await _analyze_one(m, m.get("hint") or hint))

    results = await asyncio.gather(*(run(m) for m in media))
    created: list[dict] = []
    sources = set()
    for m, result, source in results:
        sources.add(source)
        raw = await db.files.find_one({"_id": m["file_id"]})
        for vi in result.items:
            photo = await store_file(bytes(raw["data"]), raw["content_type"], move_id=move["_id"], name=vi.name, kind="item_photo") if raw else None
            item = await insert(
                "items",
                {
                    "move_id": move["_id"],
                    "room_id": room_id or m.get("room_id"),
                    "photos": [file_url(photo["_id"])] if photo else [],
                    **vi.model_dump(exclude={"confidence"}),
                    "confidence": vi.confidence,
                    "decision": None,
                    "decision_reason": None,
                    "status": "new",
                    "location": move.get("from_geo"),
                    "source": source,
                    "scan_media_id": m["_id"],
                },
            )
            await ensure_item_embedding(item)
            sugg, why = await suggest_decision(item, move)
            await db.items.update_one({"_id": item["_id"]}, {"$set": {"suggestion": {"decision": sugg, "reason": why}}})
            item["suggestion"] = {"decision": sugg, "reason": why}
            created.append(item)
            publish(move["_id"], "item", item)
        await db.scan_media.update_one({"_id": m["_id"]}, {"$set": {"analyzed": True, "analyzed_at": now()}})
    names = ", ".join(f"{i['name']} (${int(i['resale_low'])}–${int(i['resale_high'])})" for i in created[:6])
    note = "" if sources - {"fallback"} else " Offline recognizer used (AI key not set) — check the names."
    await steps.finish(
        st,
        steps.receipt("inventory", f"Found {len(created)} item{'s' if len(created) != 1 else ''}: {names}. Values are estimates based on similar items.{note}"),
    )
    from .orchestrator import replan  # late import (cycle)

    await replan(move)
    return created
