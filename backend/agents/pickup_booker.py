"""Pickup booker: city rules, free bulky-item pickups, donation drop-offs."""

from __future__ import annotations

import random
from datetime import date, timedelta

from core.db import get_db, insert, new_id
from core.events import publish
from data.city_rules import pickup_rule, rules_for

from . import steps
from .approval import gate_handler, request_approval, undo_handler
from .schedule import parse_date, pickup_plan
from .steps import nm


def rules_for_item(item: dict, city: str) -> dict | None:
    return pickup_rule(city, item.get("category") or "")


async def run_city_pickup(move: dict, items: list[dict], *, run_id=None, action_id=None) -> None:
    if not items:
        return
    city = move.get("from_city") or "Long Beach"
    rule = pickup_rule(city, items[0].get("category") or "Furniture")
    names = ", ".join(nm(i) for i in items)
    if not rule:
        await steps.quick(
            move["_id"],
            "stuff",
            f"Look up free pickup rules in {city}",
            receipt=steps.receipt("note", f"No city program on file for {city}. Use a hauler instead."),
            run_id=run_id,
            action_id=action_id,
            agent="pickup",
        )
        return
    plan = pickup_plan(parse_date(move["move_date"]), date.today(), rule["lead_time_days"])
    await steps.quick(
        move["_id"],
        "stuff",
        f"Check {city} rules for: {names}",
        reason=f"{rule['program']} is free for residents.",
        receipt=steps.receipt(
            "rules",
            " ".join(f"{n + 1}. {s}" for n, s in enumerate(rule["steps"])),
            url=rule["source_url"],
            data={"lead_time_days": rule["lead_time_days"], **plan},
        ),
        run_id=run_id,
        action_id=action_id,
        agent="pickup",
    )
    pickup_day = parse_date(plan["pickup_date"])
    task = await get_db().tasks.find_one({"move_id": move["_id"], "key": "city_pickup"})
    preview = (
        f"Submit a {rule['program']} request for {pickup_day.strftime('%a %b %-d')} at {move.get('from_address')}. "
        f"Items: {names}. Submitted by Handoff, an AI assistant, on behalf of you."
    )
    await request_approval(
        move["_id"],
        "stuff",
        f"Book free city pickup on {pickup_day.strftime('%a %b %-d')}",
        handler="book_city_pickup",
        payload={"item_ids": [i["_id"] for i in items], "pickup_date": plan["pickup_date"], "program": rule["program"], "city": city},
        kind="submission",
        preview=preview,
        reason=plan.get("note") or f"Booked {14} days ahead as recommended.",
        cta="Approve & submit",
        run_id=run_id,
        action_id=action_id,
        task_id=task["_id"] if task else None,
        agent="pickup",
    )


@gate_handler("book_city_pickup")
async def _book(move: dict, step: dict, payload: dict) -> dict:
    db = get_db()
    confirmation = f"{payload['city'][:2].upper()}-SC-{random.randint(10000, 99999)}"
    pickup_day = parse_date(payload["pickup_date"])
    await db.items.update_many(
        {"_id": {"$in": payload["item_ids"]}}, {"$set": {"status": "pickup_booked", "pickup_date": payload["pickup_date"], "pickup_confirmation": confirmation}}
    )
    await db.tasks.update_one({"move_id": move["_id"], "key": "city_pickup"}, {"$set": {"status": "done", "notes": f"Confirmation {confirmation}"}})
    night_before = (pickup_day - timedelta(days=1)).isoformat()
    await db.tasks.update_one(
        {"move_id": move["_id"], "key": "curb_night_before"},
        {
            "$set": {
                "move_id": move["_id"],
                "key": "curb_night_before",
                "lane": "stuff",
                "title": "Put pickup items at the curb tonight",
                "due_date": night_before,
                "clock": "pickup",
                "status": "todo",
                "related_item_ids": payload["item_ids"],
                "notes": f"{payload['program']} — confirmation {confirmation}",
                "pinned": True,
            },
            "$setOnInsert": {"_id": new_id()},
        },
        upsert=True,
    )
    await insert(
        "messages",
        {
            "move_id": move["_id"],
            "direction": "out",
            "channel": "web",
            "to": payload["program"],
            "body": f"Pickup request submitted for {payload['pickup_date']}",
            "status": "simulated",
        },
    )
    for iid in payload["item_ids"]:
        publish(move["_id"], "item", {"id": iid})
    return {
        "receipt": steps.receipt("confirmation", f"Booked {pickup_day.strftime('%a %b %-d')}. Confirmation {confirmation}. Reminder set for the night before."),
        "undo": {"handler": "cancel_city_pickup", "payload": payload | {"confirmation": confirmation}, "label": "Pickup request cancelled."},
    }


@undo_handler("cancel_city_pickup")
async def _cancel(move: dict, step: dict, payload: dict) -> None:
    db = get_db()
    await db.items.update_many({"_id": {"$in": payload["item_ids"]}}, {"$set": {"status": "decided"}, "$unset": {"pickup_confirmation": ""}})
    await db.tasks.delete_one({"move_id": move["_id"], "key": "curb_night_before"})
    await db.tasks.update_one({"move_id": move["_id"], "key": "city_pickup"}, {"$set": {"status": "todo"}})


async def run_donation(move: dict, items: list[dict], *, run_id=None, action_id=None) -> None:
    if not items:
        return
    city = move.get("from_city") or ""
    rule = next((r for r in rules_for(city) if r["category"] == "donation"), None)
    names = ", ".join(nm(i) for i in items)
    text = f"{rule['program']}: {' '.join(rule['steps'])}" if rule else "Drop off at the nearest donation center."
    await steps.quick(
        move["_id"],
        "stuff",
        f"Plan a donation drop-off: {names}",
        receipt=steps.receipt("rules", text, url=rule["source_url"] if rule else None),
        run_id=run_id,
        action_id=action_id,
        agent="pickup",
    )
    await get_db().items.update_many({"_id": {"$in": [i["_id"] for i in items]}}, {"$set": {"status": "donation_planned"}})
