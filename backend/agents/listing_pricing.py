"""Listing and pricing agent: listings, price-drop schedules, public pages and interest requests."""

from __future__ import annotations

import re
from datetime import date

from pydantic import BaseModel, Field

from ai.llm import text_json
from core.config import get_settings
from core.db import get_db, insert, new_id, now
from core.events import publish
from services import sms

from . import steps
from .approval import gate_handler, request_approval, undo_handler
from .schedule import current_price, parse_date, price_schedule, round_price
from .steps import nm


class ListingCopy(BaseModel):
    title: str = Field(max_length=80)
    description: str = Field(max_length=900)


def slugify(text: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "item"
    return f"{base}-{new_id()[:6]}"


def start_price_for(item: dict) -> float:
    lo, hi = float(item.get("resale_low") or 0), float(item.get("resale_high") or 0)
    return round_price(lo + (hi - lo) * 0.8) if hi else round_price(max(lo, 10))


def _fallback_copy(item: dict, price: float, area: str) -> ListingCopy:
    cond = {5: "Like new", 4: "Great condition", 3: "Good condition", 2: "Fair condition", 1: "Well used"}.get(
        int(item.get("condition") or 3), "Good condition"
    )
    brand = f"{item['brand_guess']} " if item.get("brand_guess") else ""
    title = f"{brand}{item['name']} — ${int(price)}"
    desc = (
        f"{cond} {brand}{nm(item)} ({item.get('dims_estimate') or 'see photos'}). "
        f"Moving soon, so it needs a new home. Pickup in {area}; you carry it out. "
        "Cash or app payment in person at pickup. Price drops every few days until it's gone."
    )
    return ListingCopy(title=title[:80], description=desc)


async def write_copy(item: dict, price: float, area: str) -> ListingCopy:
    prompt = (
        f"Write a short, honest marketplace listing. Item: {item.get('name')} ({item.get('brand_guess') or 'unknown brand'}), "
        f"condition {item.get('condition')}/5, size {item.get('dims_estimate')}. Price ${int(price)}. Pickup in {area}. "
        "Buyer pays in person at pickup. Title max 70 characters including the price. Description 2-3 sentences."
    )
    result = await text_json(ListingCopy, prompt, fallback=lambda: _fallback_copy(item, price, area))
    return result.value


async def create_listing(move: dict, item: dict, *, start_price: float | None = None) -> dict:
    db = get_db()
    existing = await db.listings.find_one({"item_id": item["_id"], "status": {"$in": ["draft", "active"]}})
    if existing:
        return existing
    price = start_price or start_price_for(item)
    sched = price_schedule(price, move["move_date"])
    area = move.get("from_area") or move.get("from_city") or ""
    copy = await write_copy(item, price, area)
    doc = await insert(
        "listings",
        {
            "move_id": move["_id"],
            "item_id": item["_id"],
            "title": copy.title,
            "description": copy.description,
            "price_schedule": [p.__dict__ for p in sched.points],
            "cutoff": sched.cutoff,
            "current_price": sched.points[0].price,
            "public_slug": slugify(item["name"]),
            "status": "draft",
            "interest_requests": [],
            "pickup_area": area,
        },
    )
    await db.items.update_one({"_id": item["_id"]}, {"$set": {"listing_id": doc["_id"]}})
    return doc


def schedule_text(listing: dict) -> str:
    pts = listing["price_schedule"]
    parts = [f"${int(p['price'])} on {parse_date(p['date']).strftime('%b %-d')}" for p in pts]
    return " → ".join(parts) + f" → unsold on {parse_date(listing['cutoff']).strftime('%b %-d')} goes to Handoff/Donate"


def listing_url(listing: dict) -> str:
    return f"{get_settings().frontend_url}/l/{listing['public_slug']}"


async def run_list_item(move: dict, item: dict, *, run_id=None, action_id=None, start_price=None) -> None:
    lane = "stuff"
    st = await steps.create_step(
        move["_id"], lane, f"Price the {nm(item)} from similar items", state="running", run_id=run_id, action_id=action_id, agent="listing"
    )
    await steps.pace()
    lo, hi = int(item.get("resale_low") or 0), int(item.get("resale_high") or 0)
    await steps.finish(st, steps.receipt("estimate", f"${lo}–${hi} (estimate based on similar items). Start at ${int(start_price or start_price_for(item))}."))
    st = await steps.create_step(
        move["_id"], lane, f"Draft listing and public page for the {nm(item)}", state="running", run_id=run_id, action_id=action_id, agent="listing"
    )
    listing = await create_listing(move, item, start_price=start_price)
    await steps.pace()
    await steps.finish(st, steps.receipt("listing", listing["title"], url=f"/l/{listing['public_slug']}", image=(item.get("photos") or [None])[0]))
    task = await get_db().tasks.find_one({"move_id": move["_id"], "key": f"sell:{item['_id']}"})
    await request_approval(
        move["_id"],
        lane,
        f"Approve the price-drop schedule for the {nm(item)}",
        handler="activate_listing",
        payload={"listing_id": listing["_id"]},
        kind="approval",
        preview=schedule_text(listing),
        reason="Prices drop 15% every 4 days so it sells before move day.",
        cta="Approve schedule & publish",
        run_id=run_id,
        action_id=action_id,
        task_id=task["_id"] if task else None,
        agent="listing",
    )


@gate_handler("activate_listing")
async def _activate(move: dict, step: dict, payload: dict) -> dict:
    db = get_db()
    listing = await db.listings.find_one({"_id": payload["listing_id"]})
    await db.listings.update_one({"_id": listing["_id"]}, {"$set": {"status": "active", "published_at": now()}})
    await db.items.update_one({"_id": listing["item_id"]}, {"$set": {"status": "listed"}})
    await db.tasks.update_one({"move_id": move["_id"], "key": f"sell:{listing['item_id']}"}, {"$set": {"status": "in_progress"}})
    publish(move["_id"], "item", {"id": listing["item_id"]})
    return {
        "receipt": steps.receipt(
            "listing", f"Live at ${int(listing['current_price'])}. Share the link or copy it to Marketplace.", url=f"/l/{listing['public_slug']}"
        ),
        "undo": {"handler": "unpublish_listing", "payload": {"listing_id": listing["_id"]}, "label": "Listing unpublished."},
    }


@undo_handler("unpublish_listing")
async def _unpublish(move: dict, step: dict, payload: dict) -> None:
    db = get_db()
    listing = await db.listings.find_one({"_id": payload["listing_id"]})
    await db.listings.update_one({"_id": listing["_id"]}, {"$set": {"status": "draft"}})
    await db.items.update_one({"_id": listing["item_id"]}, {"$set": {"status": "decided"}})
    publish(move["_id"], "item", {"id": listing["item_id"]})


async def add_interest(listing: dict, name: str, contact: str, proposed_time: str, message: str | None) -> dict:
    req = {"id": new_id()[:10], "name": name, "contact": contact, "proposed_time": proposed_time, "message": message, "status": "new", "created_at": now()}
    await get_db().listings.update_one({"_id": listing["_id"]}, {"$push": {"interest_requests": req}})
    publish(listing["move_id"], "inbox", {"listing_id": listing["_id"]})
    publish(listing["move_id"], "toast", {"title": "New pickup request", "body": f"{name} wants to pick up {proposed_time}."})
    return req


async def propose_interest_reply(move: dict, user: dict, listing: dict, request_id: str) -> dict:
    req = next(r for r in listing["interest_requests"] if r["id"] == request_id)
    body = sms.disclose(
        f"Hi {req['name']}, {req['proposed_time']} works for pickup of \"{listing['title']}\" in {listing.get('pickup_area') or 'town'}. "
        "Payment in person at pickup. The exact address follows the day before.",
        user["name"],
    )
    return await request_approval(
        move["_id"],
        "stuff",
        f"Confirm pickup time with {req['name']}",
        handler="confirm_buyer",
        payload={"listing_id": listing["_id"], "request_id": request_id, "message": body},
        kind="message",
        preview=body,
        reason=f"{req['name']} asked for {req['proposed_time']}.",
        cta="Approve & send",
        agent="listing",
    )


@gate_handler("confirm_buyer")
async def _confirm_buyer(move: dict, step: dict, payload: dict) -> dict:
    db = get_db()
    listing = await db.listings.find_one({"_id": payload["listing_id"]})
    req = next(r for r in listing["interest_requests"] if r["id"] == payload["request_id"])
    result = await sms.send_sms(req["contact"], payload["message"]) if req["contact"].startswith("+") else {"status": "simulated"}
    await db.listings.update_one({"_id": listing["_id"], "interest_requests.id": req["id"]}, {"$set": {"interest_requests.$.status": "confirmed"}})
    await insert(
        "messages", {"move_id": move["_id"], "direction": "out", "channel": "sms", "to": req["name"], "body": payload["message"], "status": result["status"]}
    )
    return {"receipt": steps.receipt("sms", f"Pickup confirmed with {req['name']} ({result['status']}).", data={"message": payload["message"]})}


async def mark_sold(move: dict, listing: dict, price: float) -> dict:
    db = get_db()
    await db.listings.update_one({"_id": listing["_id"]}, {"$set": {"status": "sold", "sold_price": price, "sold_at": now()}})
    await db.items.update_one({"_id": listing["item_id"]}, {"$set": {"status": "sold", "sold_price": price}})
    await db.tasks.update_one({"move_id": move["_id"], "key": f"sell:{listing['item_id']}"}, {"$set": {"status": "done"}})
    item = await db.items.find_one({"_id": listing["item_id"]})
    await steps.quick(
        move["_id"],
        "stuff",
        f"Marked the {nm(item)} sold",
        receipt=steps.receipt("payment", f"Sold for ${int(price)} — paid in person.", amount=price),
        agent="listing",
    )
    publish(move["_id"], "money", {})
    return await db.listings.find_one({"_id": listing["_id"]})


async def refresh_prices(move: dict, today: date | None = None) -> None:
    db = get_db()
    async for listing in db.listings.find({"move_id": move["_id"], "status": "active"}):
        price = current_price(listing["price_schedule"], today)
        if price is not None and price != listing.get("current_price"):
            await db.listings.update_one({"_id": listing["_id"]}, {"$set": {"current_price": price}})
