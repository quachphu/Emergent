"""Orchestrator: builds and replans the backward schedule across all five lanes, proposes agent runs
("Here's what I'll do"), executes approved runs step by step, and summarizes the move."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta

from core.db import get_db, insert, new_id, now
from core.events import publish
from data.city_rules import pickup_rule
from models.schemas import LANE_META, LANES
from services.geo import commute_minutes, driving_miles

from . import (
    booking,  # noqa: F401  (registers gate handlers)
    steps,
)
from .listing_pricing import refresh_prices, run_list_item, start_price_for
from .matchmaker import best_match_for_item, propose_offer, run_matching
from .pickup_booker import run_city_pickup, run_donation
from .schedule import (
    SELL_CUTOFF_DAYS,
    STATIC_TASKS,
    TRANSPORT_BY_METHOD,
    days_left,
    list_date,
    notice_due,
    parse_date,
    pickup_plan,
    task_due,
)
from .steps import nm
from .vendor_outreach import run_quotes

log = logging.getLogger("handoff.orchestrator")

RESOLVED_ITEM_STATUSES = {
    "listed",
    "offered",
    "handoff_scheduled",
    "handed_off",
    "sold",
    "pickup_booked",
    "haul_booked",
    "donation_planned",
    "donated",
    "recycled",
    "hauled",
}
REHOMED_STATUSES = {"sold", "handoff_scheduled", "handed_off", "donated", "donation_planned"}
DIVERTED_STATUSES = REHOMED_STATUSES | {"pickup_booked", "recycled"}
_bg: set[asyncio.Task] = set()


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _bg.add(task)
    task.add_done_callback(_bg.discard)
    return task


def _names(items: list[dict], n: int = 3) -> str:
    names = [nm(i) for i in items]
    if len(names) <= n:
        return ", ".join(names)
    return ", ".join(names[:n]) + f" +{len(names) - n} more"


# ---------------------------------------------------------------- planning


async def desired_tasks(move: dict, today: date | None = None) -> list[dict]:
    today = today or date.today()
    md = parse_date(move["move_date"])
    db = get_db()
    items = [i async for i in db.items.find({"move_id": move["_id"], "status": {"$ne": "deleted"}})]
    out: list[dict] = []

    def add(key, lane, title, due, clock, notes="", related=None, tight=None):
        out.append(
            {
                "key": key,
                "lane": lane,
                "title": title,
                "due_date": due.iso(),
                "clock": clock,
                "notes": notes,
                "tight": due.tight if tight is None else tight,
                "related_item_ids": related or [],
            }
        )

    for lane, rows in STATIC_TASKS.items():
        for key, title, days_before, clock, notes in rows:
            if key == "notice_to_vacate":
                due = notice_due(md, today, int(move.get("notice_period_days") or 30))
                add(key, lane, title, due, clock, notes)
                continue
            add(key, lane, title, task_due(md, today, days_before), clock, notes)
    for key, title, days_before, clock, notes in TRANSPORT_BY_METHOD.get(move.get("move_method", "movers"), []):
        add(key, "transport", title, task_due(md, today, days_before), clock, notes)

    by: dict[str, list[dict]] = {}
    for it in items:
        if it.get("decision"):
            by.setdefault(it["decision"], []).append(it)

    for it in by.get("SELL", []):
        ld = list_date(md, today)
        add(
            f"sell:{it['_id']}",
            "stuff",
            f"Sell the {nm(it)}",
            task_due(md, today, SELL_CUTOFF_DAYS),
            "sell",
            f"List {ld.strftime('%b %-d')}, 15% drop every 4 days, unsold at 5 days → Handoff/Donate.",
            [it["_id"]],
        )
    for it in by.get("HANDOFF", []):
        add(
            f"handoff:{it['_id']}",
            "stuff",
            f"Hand off the {nm(it)} to an arrival",
            task_due(md, today, 3),
            "pickup",
            "Matched by need, city and date.",
            [it["_id"]],
        )
    if by.get("CITY_PICKUP"):
        group = by["CITY_PICKUP"]
        rule = pickup_rule(move.get("from_city") or "", group[0].get("category") or "")
        plan = pickup_plan(md, today, rule["lead_time_days"] if rule else 7)
        from .schedule import Due

        add(
            "city_pickup",
            "stuff",
            f"Book free city pickup: {_names(group)}",
            Due(parse_date(plan["book_by"]), plan["tight"]),
            "pickup",
            (rule["program"] + ". " if rule else "") + (plan.get("note") or f"Pickup {plan['pickup_date']}."),
            [i["_id"] for i in group],
        )
    if by.get("DONATE"):
        add("donate", "stuff", f"Drop off donations: {_names(by['DONATE'])}", task_due(md, today, 3), "pickup", "", [i["_id"] for i in by["DONATE"]])
    if by.get("RECYCLE"):
        add("recycle", "stuff", f"Recycle: {_names(by['RECYCLE'])}", task_due(md, today, 2), "pickup", "", [i["_id"] for i in by["RECYCLE"]])
    if by.get("HAUL"):
        ids = [i["_id"] for i in by["HAUL"]]
        add(
            "haul_quotes",
            "transport",
            f"Get haul-away quotes ({len(ids)} items)",
            task_due(md, today, 10),
            "transport",
            "One bundled job, texted to local haulers.",
            ids,
        )
        add("book_hauler", "transport", "Book a hauler", task_due(md, today, 7), "transport", "Paid with Stripe after you approve.", ids)
        add("haul_day", "transport", "Haul-away pickup", task_due(md, today, 2), "transport", "", ids)
    if move.get("car"):
        add("car_decision", "transport", "Decide: sell or ship your car", task_due(md, today, 10), "transport", "")
    return out


def _derived_status(key: str, move: dict, items: list[dict], docs: list[dict]) -> str | None:
    by_id = {i["_id"]: i for i in items}
    if key == "scan_home":
        return "done" if items else None
    if key == "decide_items":
        return "done" if items and all(i.get("decision") for i in items) else ("in_progress" if any(i.get("decision") for i in items) else None)
    if key.startswith("sell:"):
        it = by_id.get(key.split(":", 1)[1])
        return "done" if it and it.get("status") == "sold" else ("in_progress" if it and it.get("status") == "listed" else None)
    if key.startswith("handoff:"):
        it = by_id.get(key.split(":", 1)[1])
        return "done" if it and it.get("status") in {"handoff_scheduled", "handed_off"} else None
    if key == "review_lease":
        return "done" if any(d["type"] == "lease" and d.get("summary") for d in docs) else None
    if key == "notice_to_vacate" and move.get("notice_sent"):
        return "done"
    return None


RANK = {"todo": 0, "in_progress": 1, "waiting_for_user": 2, "skipped": 3, "done": 4}


async def replan(move: dict, today: date | None = None) -> list[dict]:
    """Idempotent: upserts dated tasks for all five lanes, preserves user status, removes stale ones."""
    today = today or date.today()
    db = get_db()
    move = await db.moves.find_one({"_id": move["_id"]}) or move
    await refresh_prices(move, today)
    await _sell_cutoff(move, today)
    desired = await desired_tasks(move, today)
    items = [i async for i in db.items.find({"move_id": move["_id"], "status": {"$ne": "deleted"}})]
    docs = [d async for d in db.documents.find({"move_id": move["_id"]})]
    existing = {t["key"]: t async for t in db.tasks.find({"move_id": move["_id"]})}
    keys = set()
    for t in desired:
        keys.add(t["key"])
        cur = existing.get(t["key"])
        derived = _derived_status(t["key"], move, items, docs)
        if cur:
            status = cur["status"]
            if derived and RANK[derived] > RANK.get(status, 0):
                status = derived
            await db.tasks.update_one({"_id": cur["_id"]}, {"$set": {**t, "status": status, "updated_at": now()}})
        else:
            await db.tasks.insert_one({"_id": new_id(), "move_id": move["_id"], **t, "status": derived or "todo", "created_at": now(), "updated_at": now()})
    for key, cur in existing.items():
        if key not in keys and not cur.get("pinned") and cur["status"] not in {"done"}:
            await db.tasks.delete_one({"_id": cur["_id"]})
    publish(move["_id"], "plan", {"replanned_at": now()})
    return [t async for t in db.tasks.find({"move_id": move["_id"]})]


async def _sell_cutoff(move: dict, today: date) -> None:
    """Unsold at 5 days out → HANDOFF (if an arrival needs it) or DONATE."""
    if days_left(move["move_date"], today) > SELL_CUTOFF_DAYS:
        return
    db = get_db()
    async for listing in db.listings.find({"move_id": move["_id"], "status": {"$in": ["active", "draft"]}}):
        item = await db.items.find_one({"_id": listing["item_id"]})
        if not item or item.get("status") == "sold":
            continue
        need, _ = await best_match_for_item(item, move)
        decision = "HANDOFF" if need else "DONATE"
        await db.listings.update_one({"_id": listing["_id"]}, {"$set": {"status": "expired"}})
        await db.items.update_one(
            {"_id": item["_id"]},
            {"$set": {"decision": decision, "status": "decided", "decision_reason": f"Unsold at {SELL_CUTOFF_DAYS} days out — moved to {decision.title()}."}},
        )
        await steps.quick(
            move["_id"],
            "stuff",
            f"Moved the unsold {nm(item)} to {decision.title()}",
            reason="Listings stop 5 days before move day.",
            receipt=steps.receipt("note", "Listing closed."),
        )


# ---------------------------------------------------------------- runs


async def propose_run(move: dict, user: dict) -> dict:
    db = get_db()
    await run_matching(move)
    items = [i async for i in db.items.find({"move_id": move["_id"], "status": {"$ne": "deleted"}})]
    actions: list[dict] = []

    def add(kind, title, detail="", **params):
        actions.append({"id": new_id()[:10], "kind": kind, "title": title, "detail": detail, "params": params, "enabled": True, "status": "planned"})

    for it in items:
        if it.get("decision") == "SELL" and it.get("status") not in RESOLVED_ITEM_STATUSES:
            price = start_price_for(it)
            add(
                "list_item",
                f"List the {nm(it)} at ${int(price)}",
                "Price drops 15% every 4 days; you approve the schedule.",
                item_id=it["_id"],
                start_price=price,
            )
    for it in items:
        if it.get("decision") == "HANDOFF" and it.get("status") not in RESOLVED_ITEM_STATUSES:
            match = await db.matches.find_one({"item_id": it["_id"], "status": "suggested"}, sort=[("score", -1)])
            if match:
                need = await db.needs.find_one({"_id": match["need_id"]})
                add(
                    "offer_item",
                    f"Offer the {nm(it)} to {need['arrival_name']}",
                    f"Needs \"{need['item_wanted']}\" · {int(match['score'] * 100)}% match.",
                    item_id=it["_id"],
                    match_id=match["_id"],
                )
    pickup = [i for i in items if i.get("decision") == "CITY_PICKUP" and i.get("status") not in RESOLVED_ITEM_STATUSES]
    if pickup:
        add(
            "city_pickup",
            f"Book a free city pickup for the {_names(pickup)}",
            f"{move.get('from_city')} bulky-item program.",
            item_ids=[i["_id"] for i in pickup],
        )
    haul = [i for i in items if i.get("decision") == "HAUL" and i.get("status") not in RESOLVED_ITEM_STATUSES]
    if haul and not await db.jobs.find_one({"move_id": move["_id"], "type": "haul", "status": {"$in": ["sent", "booked"]}}):
        add("haul_quotes", f"Get haul quotes for the rest ({_names(haul)})", "One job package texted to 3 local haulers.", item_ids=[i["_id"] for i in haul])
    donate = [i for i in items if i.get("decision") == "DONATE" and i.get("status") not in RESOLVED_ITEM_STATUSES]
    if donate:
        add("donate", f"Plan a donation drop-off for the {_names(donate)}", "Nearest donation center and hours.", item_ids=[i["_id"] for i in donate])
    if move.get("move_method") == "movers" and not await db.jobs.find_one({"move_id": move["_id"], "type": "mover", "status": {"$in": ["sent", "booked"]}}):
        keep = [i for i in items if i.get("decision") == "KEEP"]
        if keep:
            add("mover_quotes", f"Get mover quotes for {len(keep)} items you're keeping", "Your scan inventory becomes the moving list.")
    if not await db.documents.find_one({"move_id": move["_id"], "type": "letter", "kind": "notice"}):
        add("notice_letter", "Draft your notice-to-vacate letter", "You sign and send it yourself.")
    lease = await db.documents.find_one({"move_id": move["_id"], "type": "lease", "summary": None})
    if lease:
        add("lease_summary", "Summarize your new lease and flag clauses", "For your review, not legal advice.", doc_id=lease["_id"])

    await db.runs.delete_many({"move_id": move["_id"], "status": "proposed"})
    run = await insert("runs", {"move_id": move["_id"], "status": "proposed", "actions": actions})
    return run


async def execute_run(run_id: str) -> None:
    db = get_db()
    run = await db.runs.find_one({"_id": run_id})
    move = await db.moves.find_one({"_id": run["move_id"]})
    user = await db.users.find_one({"_id": move["user_id"]})
    enabled = [a for a in run["actions"] if a.get("enabled", True)]
    await steps.quick(
        move["_id"],
        "stuff",
        f"Plan approved — running {len(enabled)} action{'s' if len(enabled) != 1 else ''}",
        reason="Anything that contacts someone, books or pays waits for your OK.",
        receipt=steps.receipt("plan", "\n".join(f"{n + 1}. {a['title']}" for n, a in enumerate(enabled))),
        run_id=run_id,
        agent="orchestrator",
    )
    for action in enabled:
        while True:
            fresh = await db.runs.find_one({"_id": run_id})
            if fresh["status"] != "paused":
                break
            await asyncio.sleep(0.5)
        await _set_action(run_id, action["id"], "running")
        try:
            await run_action(move, user, action, run_id)
            await _set_action(run_id, action["id"], "done")
        except Exception as exc:  # noqa: BLE001
            log.exception("action %s failed", action["kind"])
            await steps.create_step(
                move["_id"],
                _lane_of(action),
                action["title"],
                state="failed",
                reason="Something went wrong. Retry when ready.",
                run_id=run_id,
                action_id=action["id"],
            )
            await _set_action(run_id, action["id"], "failed", error=type(exc).__name__)
        await steps.pace(0.5)
    await db.runs.update_one({"_id": run_id}, {"$set": {"status": "done", "finished_at": now()}})
    waiting = await db.agent_steps.count_documents({"move_id": move["_id"], "state": "waiting_for_user"})
    await steps.quick(
        move["_id"],
        "stuff",
        "Run finished",
        receipt=steps.receipt("note", f"{waiting} step{'s' if waiting != 1 else ''} waiting for your OK in the Inbox." if waiting else "Everything is moving."),
        run_id=run_id,
    )
    await replan(move)
    publish(move["_id"], "run", {"id": run_id, "status": "done"})


def _lane_of(action: dict) -> str:
    return {"haul_quotes": "transport", "mover_quotes": "transport", "notice_letter": "old_home", "lease_summary": "new_home"}.get(action["kind"], "stuff")


async def _set_action(run_id: str, action_id: str, status: str, **extra) -> None:
    db = get_db()
    run = await db.runs.find_one({"_id": run_id})
    for a in run["actions"]:
        if a["id"] == action_id:
            a["status"] = status
            a.update(extra)
    await db.runs.update_one({"_id": run_id}, {"$set": {"actions": run["actions"]}})
    publish(run["move_id"], "run", {"id": run_id})


async def run_action(move: dict, user: dict, action: dict, run_id: str | None) -> None:
    db = get_db()
    kind, p, aid = action["kind"], action.get("params") or {}, action["id"]
    if kind == "list_item":
        item = await db.items.find_one({"_id": p["item_id"]})
        await run_list_item(move, item, run_id=run_id, action_id=aid, start_price=p.get("start_price"))
    elif kind == "offer_item":
        item = await db.items.find_one({"_id": p["item_id"]})
        match = await db.matches.find_one({"_id": p["match_id"]})
        need = await db.needs.find_one({"_id": match["need_id"]})
        await steps.quick(
            move["_id"],
            "stuff",
            f"Match the {nm(item)} with arrivals",
            reason="Similarity of what they need + same city + needed-by date.",
            receipt=steps.receipt("match", f"Top match: {need['arrival_name']} — \"{need['item_wanted']}\" ({int(match['score'] * 100)}%)."),
            run_id=run_id,
            action_id=aid,
            agent="matchmaker",
        )
        task = await db.tasks.find_one({"move_id": move["_id"], "key": f"handoff:{item['_id']}"})
        await propose_offer(move, user, item, match, need, run_id=run_id, action_id=aid, task_id=task["_id"] if task else None)
    elif kind == "city_pickup":
        items = [i async for i in db.items.find({"_id": {"$in": p["item_ids"]}})]
        await run_city_pickup(move, items, run_id=run_id, action_id=aid)
    elif kind == "haul_quotes":
        await run_quotes(move, user, "haul", item_ids=p.get("item_ids"), run_id=run_id, action_id=aid)
    elif kind == "mover_quotes":
        await run_quotes(move, user, "mover", run_id=run_id, action_id=aid)
    elif kind == "donate":
        items = [i async for i in db.items.find({"_id": {"$in": p["item_ids"]}})]
        await run_donation(move, items, run_id=run_id, action_id=aid)
    elif kind == "notice_letter":
        from .home import draft_notice

        await draft_notice(move, user, run_id=run_id, action_id=aid)
    elif kind == "lease_summary":
        from .home import summarize_document

        await summarize_document(move, p["doc_id"], run_id=run_id, action_id=aid)
    else:
        raise ValueError(f"unknown action {kind}")


# ---------------------------------------------------------------- summary


async def money(move: dict) -> dict:
    db = get_db()
    items = [i async for i in db.items.find({"move_id": move["_id"], "status": {"$ne": "deleted"}})]
    earned = sum(float(i.get("sold_price") or 0) for i in items if i.get("status") == "sold")
    pot_lo = pot_hi = 0.0
    async for li in db.listings.find({"move_id": move["_id"], "status": "active"}):
        it = next((i for i in items if i["_id"] == li["item_id"]), None)
        if it:
            pot_lo += float(it.get("resale_low") or 0)
            pot_hi += float(li.get("current_price") or it.get("resale_high") or 0)
    spent = 0.0
    async for b in db.bookings.find({"move_id": move["_id"], "status": "paid"}):
        spent += float(b.get("amount") or 0)
    saved = sum(
        float(i.get("move_cost_estimate") or 0) for i in items if i.get("decision") and i["decision"] != "KEEP" and i.get("status") in DIVERTED_STATUSES
    )
    budget = float(move.get("relocation_budget") or 0)
    return {
        "earned": round(earned, 2),
        "potential_low": round(pot_lo),
        "potential_high": round(pot_hi),
        "saved": round(saved),
        "spent": round(spent, 2),
        "budget": budget,
        "budget_left": round(budget - spent + earned, 2),
        "label": "Potential and saved values are estimates based on similar items.",
    }


async def impact(move: dict) -> dict:
    items = [i async for i in get_db().items.find({"move_id": move["_id"], "status": {"$ne": "deleted"}})]
    rehomed = [i for i in items if i.get("status") in REHOMED_STATUSES]
    diverted = [i for i in items if i.get("status") in DIVERTED_STATUSES]
    earned = sum(float(i.get("sold_price") or 0) for i in items if i.get("status") == "sold")
    return {
        "items_rehomed": len(rehomed),
        "money_earned": round(earned, 2),
        "pounds_diverted": int(sum(float(i.get("weight_lbs") or 20) for i in diverted)),
        "label": "Pounds are estimates based on similar items.",
    }


async def summary(move: dict, *, replan_first: bool = True) -> dict:
    db = get_db()
    if replan_first:
        await replan(move)
    tasks = [t async for t in db.tasks.find({"move_id": move["_id"]})]
    items = [i async for i in db.items.find({"move_id": move["_id"], "status": {"$ne": "deleted"}})]
    lanes = []
    for lane in LANES:
        lt = [t for t in tasks if t["lane"] == lane]
        done = sum(1 for t in lt if t["status"] in {"done", "skipped"})
        nxt = sorted((t for t in lt if t["status"] not in {"done", "skipped"}), key=lambda t: t["due_date"])
        lanes.append(
            {
                "lane": lane,
                **LANE_META[lane],
                "total": len(lt),
                "done": done,
                "progress": round(done / len(lt), 3) if lt else 0,
                "waiting": sum(1 for t in lt if t["status"] == "waiting_for_user"),
                "next": nxt[0] if nxt else None,
            }
        )
    open_tasks = [t for t in tasks if t["status"] not in {"done", "skipped"}]
    open_tasks.sort(key=lambda t: (0 if t["status"] == "waiting_for_user" else 1, t["due_date"], 0 if t.get("tight") else 1))
    waiting_steps = await db.agent_steps.count_documents({"move_id": move["_id"], "state": "waiting_for_user"})
    new_requests = 0
    async for li in db.listings.find({"move_id": move["_id"], "interest_requests.status": "new"}):
        new_requests += sum(1 for r in li["interest_requests"] if r["status"] == "new")
    resolved_items = sum(1 for i in items if (i.get("decision") == "KEEP") or i.get("status") in RESOLVED_ITEM_STATUSES)
    done_tasks = sum(1 for t in tasks if t["status"] in {"done", "skipped"})
    # "Resolved" covers everything that has to happen by move day: every item + tasks due by then.
    md_iso = move["move_date"][:10]
    pre = [t for t in tasks if t["due_date"] <= md_iso]
    pre_done = sum(1 for t in pre if t["status"] in {"done", "skipped"})
    denom = len(pre) + len(items)
    a = move.get("from_geo", {}).get("coordinates") if move.get("from_geo") else None
    b = move.get("to_geo", {}).get("coordinates") if move.get("to_geo") else None
    w = move.get("work_geo", {}).get("coordinates") if move.get("work_geo") else None
    return {
        "move": move,
        "days_left": days_left(move["move_date"]),
        "distance_miles": driving_miles(a, b),
        "commute_minutes": commute_minutes(b, w),
        "lanes": lanes,
        "today": open_tasks[:3],
        "inbox_count": waiting_steps + new_requests,
        "money": await money(move),
        "impact": await impact(move),
        "resolved_pct": round((pre_done + resolved_items) / denom, 3) if denom else 0,
        "counts": {"items": len(items), "tasks": len(tasks), "tasks_done": done_tasks, "items_resolved": resolved_items},
    }


def move_day_window(move: dict) -> tuple[date, date]:
    md = parse_date(move["move_date"])
    return md - timedelta(days=21), md + timedelta(days=21)
