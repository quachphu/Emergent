"""Vendor outreach: bundle items into one job package, text vendors, parse replies into quotes."""

from __future__ import annotations

import asyncio
import logging
import random
import re
from datetime import date, timedelta

from ai.llm import text_json
from core.config import get_settings
from core.db import get_db, insert, now
from core.events import publish
from models.schemas import ParsedQuote
from services import sms

from . import steps
from .approval import gate_handler, request_approval
from .schedule import parse_date
from .steps import nm

log = logging.getLogger("handoff.vendors")

VOLUME_CUFT = {"S": 4, "M": 12, "L": 28, "XL": 55}
JOB_VENDOR_TYPE = {"haul": "hauler", "mover": "mover", "auto_transport": "auto_transport"}
JOB_LABEL = {"haul": "Haul-away", "mover": "Moving", "auto_transport": "Car shipping"}

# ---------------- quote parsing ----------------

_PRICE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+|\d{2,5})(?:\.(\d{2}))?|(\d{2,5})\s?(?:dollars|bucks|usd)\b", re.I)
_DECLINE = re.compile(r"\b(can'?t|cannot|unable|not available|unavailable|fully booked|no availability|sorry,? (?:we|i)|pass on this|decline)\b", re.I)
_ETA = re.compile(
    r"\b((?:today|tonight|tomorrow|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)"
    r"(?:\s+(?:morning|afternoon|evening|night))?"
    r"(?:[\s,]*(?:at|by|from|after|before|around)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*[-–to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)?)",
    re.I,
)
_TIME_ONLY = re.compile(r"\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)\b", re.I)


def parse_quote_rules(text: str) -> ParsedQuote:
    body = text or ""
    declined = bool(_DECLINE.search(body))
    prices: list[float] = []
    for m in _PRICE.finditer(body):
        raw = m.group(1) or m.group(3)
        if raw:
            val = float(raw.replace(",", ""))
            if m.group(2):
                val += float(m.group(2)) / 100
            prices.append(val)
    price = None
    if prices:
        total = re.search(r"(?:total|all[- ]in|flat|for everything)[^$\d]{0,20}\$\s?(\d[\d,]*)", body, re.I)
        price = float(total.group(1).replace(",", "")) if total else prices[0]
    eta_m = _ETA.search(body) or _TIME_ONLY.search(body)
    eta = eta_m.group(1).strip() if eta_m else None
    notes = None
    note_m = re.search(r"(includes?[^.!]*|\d+\s+(?:guys|movers|people|crew)[^.!]*|disposal[^.!]*)", body, re.I)
    if note_m:
        notes = note_m.group(1).strip()
    if declined and price is None:
        return ParsedQuote(is_quote=False, declined=True, notes=body[:140])
    return ParsedQuote(is_quote=price is not None, price=price, eta=eta, notes=notes, declined=False)


async def parse_quote(text: str) -> tuple[ParsedQuote, str]:
    prompt = (
        "A moving or hauling vendor replied to a job request by SMS. Extract the quote. "
        "is_quote=true only if they gave a price. price in USD (number, total for the job). "
        "eta = when they can arrive, as written. notes = crew/inclusions in a few words. declined=true if they said no.\n"
        f"SMS: {text}"
    )
    result = await text_json(ParsedQuote, prompt, fallback=lambda: parse_quote_rules(text))
    q = result.value
    # Guard against hallucinated prices: the number must appear in the message.
    if q.price is not None and str(int(q.price)) not in text.replace(",", ""):
        q = parse_quote_rules(text)
        return q, "fallback"
    return q, result.source


# ---------------- job packages ----------------


def time_window(move: dict, job_type: str) -> str:
    md = parse_date(move["move_date"])
    d = md - timedelta(days=2) if job_type == "haul" else md
    if d <= date.today():
        d = date.today() + timedelta(days=1)
    return f"{d.strftime('%a %b')} {d.day}, 9am–1pm"


async def build_job(
    move: dict, job_type: str, item_ids: list[str] | None = None, *, floor: int | None = None, elevator: bool | None = None, window: str | None = None
) -> dict:
    db = get_db()
    if item_ids is None:
        if job_type == "haul":
            q = {"move_id": move["_id"], "decision": "HAUL", "status": {"$nin": ["hauled", "deleted"]}}
        elif job_type == "mover":
            q = {"move_id": move["_id"], "decision": "KEEP", "status": {"$ne": "deleted"}}
        else:
            q = {"_id": "__none__"}
        items = [i async for i in db.items.find(q)]
    else:
        items = [i async for i in db.items.find({"_id": {"$in": item_ids}})]
    volume = sum(VOLUME_CUFT.get(i.get("size") or "M", 12) for i in items)
    car = move.get("car") if job_type == "auto_transport" else None
    package = {
        "item_list": [{"id": i["_id"], "name": i["name"], "size": i.get("size"), "dims": i.get("dims_estimate")} for i in items],
        "photos": [p for i in items for p in (i.get("photos") or [])[:1]],
        "volume": volume,
        "floor": floor if floor is not None else move.get("floor", 2),
        "elevator": elevator if elevator is not None else move.get("elevator", False),
        "time_window": window or time_window(move, job_type),
        "from_address": move.get("from_area") or move.get("from_city"),
        "to_address": move.get("to_city") if job_type != "haul" else None,
        "car": car,
    }
    existing = await db.jobs.find_one({"move_id": move["_id"], "type": job_type, "status": {"$in": ["draft", "sent"]}})
    if existing:
        await db.jobs.update_one({"_id": existing["_id"]}, {"$set": {"item_ids": [i["_id"] for i in items], "package": package}})
        return await db.jobs.find_one({"_id": existing["_id"]})
    return await insert(
        "jobs", {"move_id": move["_id"], "type": job_type, "item_ids": [i["_id"] for i in items], "package": package, "status": "draft", "vendor_ids": []}
    )


def job_message(user_name: str, job: dict) -> str:
    p = job["package"]
    label = JOB_LABEL[job["type"]]
    if job["type"] == "auto_transport":
        car = p.get("car") or {}
        what = f"{car.get('year', '')} {car.get('make', '')} {car.get('model', '')}".strip() or "1 sedan"
        body = f"{label} request: {what}, {p['from_address']} → {p.get('to_address')}. Ready {p['time_window']}. Reply with price + pickup date."
    else:
        names = ", ".join(nm(i) for i in p["item_list"][:8])
        more = f" +{len(p['item_list']) - 8} more" if len(p["item_list"]) > 8 else ""
        stairs = "elevator" if p["elevator"] else f"floor {p['floor']}, stairs"
        dest = f" → {p['to_address']}" if p.get("to_address") else ""
        body = (
            f"{label} request in {p['from_address']}{dest}, {p['time_window']}. {len(p['item_list'])} items: {names}{more}. "
            f"~{p['volume']} cu ft, {stairs}. Photos on request. Reply with total price + ETA."
        )
    return sms.disclose(body, user_name)


async def vendors_for(move: dict, job_type: str, limit: int = 3) -> list[dict]:
    vtype = JOB_VENDOR_TYPE[job_type]
    city = move.get("from_city") or ""
    cur = get_db().vendors.find({"type": vtype})
    vendors = [v async for v in cur]
    local = [v for v in vendors if not city or city.lower() in " ".join(v.get("service_area") or []).lower()]
    chosen = local or vendors
    chosen.sort(key=lambda v: -(v.get("rating") or 0))
    return chosen[:limit]


async def run_quotes(move: dict, user: dict, job_type: str, *, item_ids=None, run_id=None, action_id=None) -> dict | None:
    lane = "transport"
    job = await build_job(move, job_type, item_ids)
    p = job["package"]
    if job_type != "auto_transport" and not p["item_list"]:
        await steps.quick(
            move["_id"],
            lane,
            f"Nothing to {JOB_LABEL[job_type].lower()} yet",
            receipt=steps.receipt("note", "No items marked for this job."),
            run_id=run_id,
            action_id=action_id,
            agent="vendors",
        )
        return None
    await steps.quick(
        move["_id"],
        lane,
        f"Bundle {len(p['item_list']) or 1} item{'s' if len(p['item_list']) != 1 else ''} into one {JOB_LABEL[job_type].lower()} job",
        reason="One job package gets better prices than item-by-item requests.",
        receipt=steps.receipt(
            "package", f"{', '.join(i['name'] for i in p['item_list']) or 'Car'} · ~{p['volume']} cu ft · {p['time_window']}", data={"job_id": job["_id"]}
        ),
        run_id=run_id,
        action_id=action_id,
        agent="vendors",
    )
    vendors = await vendors_for(move, job_type)
    if not vendors:
        await steps.quick(
            move["_id"],
            lane,
            "Find vendors",
            receipt=steps.receipt("note", "No vendors on file for this area."),
            run_id=run_id,
            action_id=action_id,
            agent="vendors",
        )
        return job
    text = job_message(user["name"], job)
    task_key = {"haul": "haul_quotes", "mover": "mover_quotes", "auto_transport": "car_decision"}[job_type]
    task = await get_db().tasks.find_one({"move_id": move["_id"], "key": task_key})
    return await request_approval(
        move["_id"],
        lane,
        f"Text the job to {len(vendors)} {JOB_VENDOR_TYPE[job_type].replace('_', ' ')}s",
        handler="send_job_sms",
        payload={"job_id": job["_id"], "vendor_ids": [v["_id"] for v in vendors], "message": text},
        kind="message",
        preview=text + "\n\nTo: " + ", ".join(f"{v['name']} (★{v['rating']})" for v in vendors),
        reason="Quotes usually arrive within minutes; you pick one before anything is booked.",
        cta=f"Approve & text {len(vendors)} vendors",
        run_id=run_id,
        action_id=action_id,
        task_id=task["_id"] if task else None,
        agent="vendors",
    )


@gate_handler("send_job_sms")
async def _send_job(move: dict, step: dict, payload: dict) -> dict:
    db = get_db()
    job = await db.jobs.find_one({"_id": payload["job_id"]})
    vendors = [v async for v in db.vendors.find({"_id": {"$in": payload["vendor_ids"]}})]
    statuses = []
    for v in vendors:
        result = await sms.send_sms(v["phone"], payload["message"])
        statuses.append(result["status"])
        await insert(
            "messages",
            {
                "move_id": move["_id"],
                "direction": "out",
                "channel": "sms",
                "to": v["name"],
                "to_phone": v["phone"],
                "vendor_id": v["_id"],
                "job_id": job["_id"],
                "body": payload["message"],
                "status": result["status"],
            },
        )
    await db.jobs.update_one(
        {"_id": job["_id"]}, {"$set": {"status": "sent", "sent_at": now(), "vendor_ids": [v["_id"] for v in vendors], "outreach_step_id": step["_id"]}}
    )
    task_key = {"haul": "haul_quotes", "mover": "mover_quotes", "auto_transport": "car_decision"}[job["type"]]
    await db.tasks.update_one({"move_id": move["_id"], "key": task_key}, {"$set": {"status": "in_progress"}})
    if get_settings().demo_mode:
        for v in vendors:
            asyncio.create_task(_simulate_reply(job["_id"], v["_id"]))
    mode = "simulated" if all(s == "simulated" for s in statuses) else "sent"
    return {
        "keep_running": True,
        "receipt": steps.receipt("sms", f"Texted {len(vendors)} vendors ({mode}). Waiting for quotes…", data={"message": payload["message"]}),
    }


# ---------------- inbound ----------------


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")[-10:]


async def handle_inbound_sms(from_phone: str, body: str) -> dict | None:
    """Same path for Twilio webhooks and DEMO_MODE simulated replies."""
    db = get_db()
    vendor = None
    async for v in db.vendors.find({}):
        if _digits(v.get("phone", "")) == _digits(from_phone):
            vendor = v
            break
    if not vendor:
        log.info("inbound sms from unknown number")
        return None
    job = await db.jobs.find_one({"vendor_ids": vendor["_id"], "status": "sent"}, sort=[("sent_at", -1)])
    if not job:
        return None
    move_id = job["move_id"]
    await insert(
        "messages",
        {"move_id": move_id, "direction": "in", "channel": "sms", "from": vendor["name"], "vendor_id": vendor["_id"], "job_id": job["_id"], "body": body},
    )
    parsed, source = await parse_quote(body)
    sent_at = job.get("sent_at") or now()
    from core.db import as_utc

    response_min = max(1, int((now() - as_utc(sent_at)).total_seconds() // 60)) if sent_at else None
    quote = await insert(
        "quotes",
        {
            "move_id": move_id,
            "job_id": job["_id"],
            "vendor_id": vendor["_id"],
            "vendor_name": vendor["name"],
            "vendor_rating": vendor.get("rating"),
            "price": parsed.price,
            "eta": parsed.eta,
            "notes": parsed.notes,
            "message_text": body,
            "received_at": now(),
            "response_minutes": response_min,
            "parsed_by": source,
            "status": "declined" if parsed.declined or not parsed.is_quote else "open",
        },
    )
    label = f"${int(parsed.price)}" if parsed.price else ("declined" if parsed.declined else "no price")
    await steps.quick(
        move_id,
        "transport",
        f"Quote from {vendor['name']}: {label}",
        reason=f"Parsed from their SMS reply{' by AI' if source != 'fallback' else ''}.",
        receipt=steps.receipt("sms", body, amount=parsed.price, data={"quote_id": quote["_id"], "eta": parsed.eta}),
        agent="vendors",
    )
    publish(move_id, "quote", quote)
    # Close the "waiting for quotes" step once every vendor answered.
    n_replies = await db.quotes.count_documents({"job_id": job["_id"]})
    if n_replies >= len(job.get("vendor_ids") or []) and job.get("outreach_step_id"):
        st = await db.agent_steps.find_one({"_id": job["outreach_step_id"]})
        if st and st["state"] == "running":
            n_open = await db.quotes.count_documents({"job_id": job["_id"], "status": "open"})
            await steps.finish(st, steps.receipt("sms", f"{n_open} quotes ready — compare them side by side and book one."))
            publish(move_id, "toast", {"title": f"{n_open} quotes ready", "body": "Compare and book in Transport."})
    return quote


REPLY_TEMPLATES = [
    "Hi! We can take all of it for ${price} total, {eta}. 2 guys + truck, includes disposal fees.",
    "Hey this is {name}. ${price} flat, {eta}. Price includes loading from the {floor_word} floor.",
    "Thanks for the details. Our quote is ${price} all-in. Earliest is {eta}. We donate what we can.",
]
ETAS = ["Sat 9–11am", "Fri after 2pm", "tomorrow 10am", "Sun 8am", "Thu 1–3pm"]


def simulated_price(job: dict, vendor: dict) -> int:
    p = job["package"]
    if job["type"] == "auto_transport":
        base = 640
    elif job["type"] == "mover":
        base = 900 + p["volume"] * 6
    else:
        base = 95 + p["volume"] * 1.1
    if not p.get("elevator") and (p.get("floor") or 1) > 1:
        base += 15 * ((p.get("floor") or 1) - 1)
    mult = vendor.get("price_factor", 1.0) * random.uniform(0.95, 1.05)
    return int(round(base * mult / 5.0) * 5)


async def _simulate_reply(job_id: str, vendor_id: str) -> None:
    s = get_settings()
    await asyncio.sleep(random.uniform(s.sim_reply_min, s.sim_reply_max))
    db = get_db()
    job = await db.jobs.find_one({"_id": job_id})
    vendor = await db.vendors.find_one({"_id": vendor_id})
    if not job or not vendor or job.get("status") != "sent":
        return
    idx = int(vendor.get("template", 0)) % len(REPLY_TEMPLATES)
    floor = job["package"].get("floor") or 1
    floor_word = {1: "1st", 2: "2nd", 3: "3rd"}.get(floor, f"{floor}th")
    body = REPLY_TEMPLATES[idx].format(price=simulated_price(job, vendor), eta=random.choice(ETAS), name=vendor["name"], floor_word=floor_word)
    try:
        await handle_inbound_sms(vendor["phone"], body)
    except Exception:  # noqa: BLE001
        log.exception("simulated reply failed")
