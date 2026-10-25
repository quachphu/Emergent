"""Matchmaker: arrivals' needs ↔ let-go items, by embedding similarity plus city and dates."""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import date, datetime, timedelta

from ai.embeddings import cosine, embed, embed_one
from core.config import get_settings
from core.db import get_db, insert, new_id, now
from core.events import publish
from services import sms

from . import steps
from .approval import gate_handler, request_approval
from .schedule import parse_date
from .steps import nm

log = logging.getLogger("handoff.matchmaker")

MATCH_THRESHOLD = 0.50
SIM_WEIGHT, CITY_WEIGHT, DATE_WEIGHT = 0.80, 0.10, 0.10
# Minimum raw similarity per embedding model (hashed fallback vectors are sparser than Voyage's).
MIN_SIM = {"local-hash-2048": 0.30}
DEFAULT_MIN_SIM = 0.45


def min_sim(model: str | None) -> float:
    return MIN_SIM.get(model or "", DEFAULT_MIN_SIM)


def item_text(item: dict) -> str:
    parts = [item.get("name") or "", item.get("category") or "", item.get("brand_guess") or "", item.get("dims_estimate") or ""]
    return ". ".join(p for p in parts if p)


def need_text(need: dict) -> str:
    return f"{need.get('item_wanted', '')}. {need.get('details', '')}".strip()


async def ensure_item_embedding(item: dict) -> dict:
    vec, model = await embed_one(item_text(item), "document")
    await get_db().items.update_one({"_id": item["_id"]}, {"$set": {"embedding": vec, "embedding_model": model}})
    item["embedding"], item["embedding_model"] = vec, model
    return item


async def ensure_need_embedding(need: dict) -> dict:
    vec, model = await embed_one(need_text(need), "query")
    await get_db().needs.update_one({"_id": need["_id"]}, {"$set": {"embedding": vec, "embedding_model": model}})
    need["embedding"], need["embedding_model"] = vec, model
    return need


def _same_city(a: str, b: str) -> bool:
    return bool(a and b) and (a.lower() in b.lower() or b.lower() in a.lower())


def score(item: dict, need: dict, item_city: str, move_date: str, today: date | None = None) -> float:
    """0..1. Zero unless the arrival is in the item's city (pickups are local) and the
    similarity clears the model's minimum."""
    today = today or date.today()
    sim = cosine(item.get("embedding"), need.get("embedding"))
    if not _same_city(item_city, need.get("city", "")) or sim < min_sim(item.get("embedding_model")):
        return 0.0
    needed_by = need.get("needed_by")
    date_ok = 1.0
    if needed_by:
        date_ok = 0.0 if parse_date(needed_by) < today else 1.0
    return round(min(1.0, SIM_WEIGHT * sim + CITY_WEIGHT + DATE_WEIGHT * date_ok + 0.1), 4)


def pickup_windows(move_date: str, today: date | None = None) -> list[str]:
    today = today or date.today()
    md = parse_date(move_date)
    out = []
    for offset, slot in [(3, "10am–12pm"), (2, "5–7pm"), (4, "9–11am")]:
        d = md - timedelta(days=offset)
        if d <= today:
            d = today + timedelta(days=1)
        out.append(f"{d.strftime('%a %b')} {d.day}, {slot}")
    return list(dict.fromkeys(out))


async def _vectors_aligned(items: list[dict], needs: list[dict]) -> None:
    """Make sure every vector in play comes from the same embedding model."""
    models = {i.get("embedding_model") for i in items} | {n.get("embedding_model") for n in needs}
    if len(models) == 1 and None not in models:
        return
    if items:
        vecs, model = await embed([item_text(i) for i in items], "document")
        for i, v in zip(items, vecs, strict=False):
            i["embedding"], i["embedding_model"] = v, model
            await get_db().items.update_one({"_id": i["_id"]}, {"$set": {"embedding": v, "embedding_model": model}})
    if needs:
        vecs, model = await embed([need_text(n) for n in needs], "query")
        for n, v in zip(needs, vecs, strict=False):
            n["embedding"], n["embedding_model"] = v, model
            await get_db().needs.update_one({"_id": n["_id"]}, {"$set": {"embedding": v, "embedding_model": model}})


async def run_matching(move: dict) -> list[dict]:
    """Recompute matches for every let-go item in this move. Keeps statuses of existing matches."""
    db = get_db()
    items = [i async for i in db.items.find({"move_id": move["_id"], "decision": {"$nin": ["KEEP"]}, "status": {"$nin": ["sold", "handed_off", "deleted"]}})]
    needs = [n async for n in db.needs.find({"status": {"$in": ["open", None]}})]
    if not items or not needs:
        return []
    await _vectors_aligned(items, needs)
    city = move.get("from_city", "")
    windows = pickup_windows(move["move_date"])
    results = []
    for item in items:
        for need in needs:
            sc = score(item, need, city, move["move_date"])
            if sc < MATCH_THRESHOLD:
                continue
            existing = await db.matches.find_one({"item_id": item["_id"], "need_id": need["_id"]})
            if existing:
                await db.matches.update_one({"_id": existing["_id"]}, {"$set": {"score": sc}})
                existing["score"] = sc
                results.append(existing)
            else:
                doc = await insert(
                    "matches",
                    {
                        "move_id": move["_id"],
                        "item_id": item["_id"],
                        "need_id": need["_id"],
                        "score": sc,
                        "pickup_window": None,
                        "pickup_windows": windows,
                        "status": "suggested",
                        "token": new_id()[:12],
                    },
                )
                results.append(doc)
    publish(move["_id"], "matches", {"count": len(results)})
    return results


async def best_match_for_item(item: dict, move: dict) -> tuple[dict | None, float]:
    db = get_db()
    needs = [n async for n in db.needs.find({"status": {"$in": ["open", None]}})]
    if not needs:
        return None, 0.0
    if not item.get("embedding"):
        await ensure_item_embedding(item)
    await _vectors_aligned([item], needs)
    best, best_score = None, 0.0
    for need in needs:
        sc = score(item, need, move.get("from_city", ""), move["move_date"])
        if sc > best_score:
            best, best_score = need, sc
    return (best, best_score) if best_score >= MATCH_THRESHOLD else (None, best_score)


async def has_match(item: dict, move: dict) -> bool:
    need, _ = await best_match_for_item(item, move)
    return need is not None


def offer_message(user_name: str, item: dict, need: dict, windows: list[str], area: str) -> str:
    body = (
        f"Hi {need.get('arrival_name')}! {user_name} is moving out and has a free {nm(item)} "
        f"that fits your request (\"{need.get('item_wanted')}\"). Pickup in {area}. "
        f"Pick a window: {' / '.join(windows)}. Reply YES with a window to claim it."
    )
    return sms.disclose(body, user_name)


async def propose_offer(move: dict, user: dict, item: dict, match: dict, need: dict, *, run_id=None, action_id=None, task_id=None) -> dict:
    windows = match.get("pickup_windows") or pickup_windows(move["move_date"])
    area = move.get("from_area") or move.get("from_city") or "your area"
    text = offer_message(user["name"], item, need, windows, area)
    return await request_approval(
        move["_id"],
        "stuff",
        f"Offer the {nm(item)} to {need['arrival_name']}",
        handler="send_handoff_offer",
        payload={"match_id": match["_id"], "message": text},
        kind="message",
        preview=text,
        reason=f"{need['arrival_name']} needs \"{need['item_wanted']}\" (match {int(match['score'] * 100)}%).",
        cta="Approve & send offer",
        run_id=run_id,
        action_id=action_id,
        task_id=task_id,
        agent="matchmaker",
    )


@gate_handler("send_handoff_offer")
async def _send_offer(move: dict, step: dict, payload: dict) -> dict:
    db = get_db()
    match = await db.matches.find_one({"_id": payload["match_id"]})
    need = await db.needs.find_one({"_id": match["need_id"]})
    item = await db.items.find_one({"_id": match["item_id"]})
    result = await sms.send_sms(need.get("contact") or "", payload["message"]) if need.get("contact", "").startswith("+") else {"status": "simulated"}
    await insert(
        "messages",
        {
            "move_id": move["_id"],
            "direction": "out",
            "channel": "sms",
            "to": need.get("arrival_name"),
            "body": payload["message"],
            "status": result["status"],
            "match_id": match["_id"],
        },
    )
    await db.matches.update_one({"_id": match["_id"]}, {"$set": {"status": "offered", "offered_at": now()}})
    await db.items.update_one({"_id": item["_id"]}, {"$set": {"status": "offered"}})
    publish(move["_id"], "item", {"id": item["_id"]})
    if get_settings().demo_mode:
        asyncio.create_task(_simulate_accept(move["_id"], match["_id"], step["_id"]))
        return {
            "keep_running": True,
            "receipt": steps.receipt(
                "sms", f"Offer sent to {need['arrival_name']} ({result['status']}). Waiting for them to pick a window…", data={"message": payload["message"]}
            ),
        }
    return {"receipt": steps.receipt("sms", f"Offer sent to {need['arrival_name']} ({result['status']}).", data={"message": payload["message"]})}


async def accept_window(match_id: str, window: str | None = None, *, step_id: str | None = None) -> dict:
    """Arrival accepts a pickup window (public page, or simulated in DEMO_MODE)."""
    db = get_db()
    match = await db.matches.find_one({"_id": match_id})
    if not match:
        raise ValueError("Match not found")
    window = window or (match.get("pickup_windows") or ["soon"])[0]
    await db.matches.update_one({"_id": match_id}, {"$set": {"status": "accepted", "pickup_window": window, "accepted_at": now()}})
    await db.needs.update_one({"_id": match["need_id"]}, {"$set": {"status": "matched"}})
    await db.items.update_one({"_id": match["item_id"]}, {"$set": {"status": "handoff_scheduled", "decision": "HANDOFF", "handoff_window": window}})
    need = await db.needs.find_one({"_id": match["need_id"]})
    item = await db.items.find_one({"_id": match["item_id"]})
    move_id = match["move_id"]
    if step_id is None:
        st = await db.agent_steps.find_one({"gate.payload.match_id": match_id})
        step_id = st["_id"] if st else None
    if step_id:
        st = await db.agent_steps.find_one({"_id": step_id})
        await steps.finish(st, steps.receipt("confirmation", f"{need['arrival_name']} accepted pickup {window} for the {nm(item)}."))
    await db.tasks.update_many({"move_id": move_id, "key": f"handoff:{item['_id']}"}, {"$set": {"status": "done"}})
    await insert(
        "messages",
        {
            "move_id": move_id,
            "direction": "in",
            "channel": "sms",
            "from": need["arrival_name"],
            "body": f"YES — {window} works. Thank you!",
            "match_id": match_id,
        },
    )
    publish(move_id, "item", {"id": item["_id"]})
    publish(move_id, "toast", {"title": "Handoff confirmed", "body": f"{need['arrival_name']} will pick up the {nm(item)} {window}."})
    return await db.matches.find_one({"_id": match_id})


async def _simulate_accept(move_id: str, match_id: str, step_id: str) -> None:
    s = get_settings()
    await asyncio.sleep(random.uniform(min(3, s.sim_reply_min), max(3, s.sim_reply_min + 3)) if s.sim_reply_max > 0 else 0)
    try:
        await accept_window(match_id, step_id=step_id)
    except Exception:  # noqa: BLE001
        log.exception("simulated accept failed")


def _iso(d) -> str | None:
    if isinstance(d, datetime):
        return d.date().isoformat()
    return d
