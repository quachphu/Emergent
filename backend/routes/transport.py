import logging

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import Response

from agents.approval import request_approval  # noqa: F401
from agents.booking import mark_booking_paid, propose_booking
from agents.orchestrator import spawn
from agents.pickup_booker import rules_for_item
from agents.vendor_outreach import build_job, handle_inbound_sms, run_quotes
from core.config import get_settings
from core.db import get_db, to_json
from core.deps import current_move, current_user
from data.city_rules import rules_for
from models.schemas import JobIn
from services import stripe_service

log = logging.getLogger("handoff.transport")
router = APIRouter(tags=["transport"])


@router.get("/city-rules")
async def city_rules(move: dict = Depends(current_move)):
    db = get_db()
    from_city, to_city = move.get("from_city") or "", move.get("to_city") or ""
    per_item = []
    async for it in db.items.find({"move_id": move["_id"], "decision": {"$in": ["CITY_PICKUP", "RECYCLE", "DONATE"]}}):
        rule = rules_for_item(it, from_city)
        per_item.append({"item": to_json(it), "rule": rule})
    return {
        "from_city": from_city,
        "to_city": to_city,
        "from_rules": rules_for(from_city),
        "to_rules": rules_for(to_city),
        "per_item": per_item,
        "note": "City programs change — confirm with the source link before relying on it.",
    }


@router.get("/vendors")
async def vendors(move: dict = Depends(current_move)):
    return to_json([v async for v in get_db().vendors.find({})])


@router.get("/jobs")
async def jobs(move: dict = Depends(current_move)):
    db = get_db()
    out = []
    async for j in db.jobs.find({"move_id": move["_id"]}).sort("created_at", -1):
        j["quotes"] = [q async for q in db.quotes.find({"job_id": j["_id"]}).sort("price", 1)]
        j["booking"] = await db.bookings.find_one({"job_id": j["_id"]}, sort=[("created_at", -1)])
        out.append(j)
    return to_json(out)


@router.post("/jobs")
async def create_job(body: JobIn, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    if body.type == "auto_transport" and not move.get("car"):
        raise HTTPException(422, "Add your car first (Transport → Car).")
    job = await build_job(move, body.type, body.item_ids, floor=body.floor, elevator=body.elevator, window=body.time_window)
    spawn(run_quotes(move, user, body.type, item_ids=job["item_ids"] or None))
    return to_json(job)


@router.post("/quotes/{quote_id}/book")
async def book(quote_id: str, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    q = await get_db().quotes.find_one({"_id": quote_id, "move_id": move["_id"]})
    if not q or q["status"] != "open" or not q.get("price"):
        raise HTTPException(409, "This quote can't be booked.")
    return to_json(await propose_booking(move, user, q))


@router.post("/bookings/{booking_id}/confirm")
async def confirm(booking_id: str, session_id: str | None = None, move: dict = Depends(current_move)):
    """Called on return from Stripe Checkout: verifies the session with Stripe (works without webhooks)."""
    db = get_db()
    b = await db.bookings.find_one({"_id": booking_id, "move_id": move["_id"]})
    if not b:
        raise HTTPException(404, "Booking not found.")
    if b["status"] == "paid":
        return to_json(b)
    sid = session_id or b.get("stripe_session_id")
    session = await stripe_service.retrieve_session(sid) if sid else None
    if session and session["payment_status"] == "paid" and session["metadata"].get("booking_id") == booking_id:
        b = await mark_booking_paid(booking_id, session_id=session["id"], amount=session["amount_total"], receipt_url=session["receipt_url"])
    return to_json(b)


@router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, move: dict = Depends(current_move)):
    db = get_db()
    b = await db.bookings.find_one({"_id": booking_id, "move_id": move["_id"]})
    if not b:
        raise HTTPException(404, "Booking not found.")
    q = await db.quotes.find_one({"_id": b["quote_id"]})
    v = await db.vendors.find_one({"_id": b["vendor_id"]})
    return to_json({**b, "quote": q, "vendor": v})


@router.post("/bookings/{booking_id}/simulate-pay")
async def simulate_pay(booking_id: str, move: dict = Depends(current_move)):
    """In-app test checkout, only for bookings that had no real Stripe session."""
    db = get_db()
    b = await db.bookings.find_one({"_id": booking_id, "move_id": move["_id"]})
    if not b:
        raise HTTPException(404, "Booking not found.")
    if not b.get("simulated"):
        raise HTTPException(409, "This booking uses real Stripe Checkout.")
    return to_json(await mark_booking_paid(booking_id, session_id=b.get("stripe_session_id"), receipt_url=None))


# ---------------- webhooks ----------------


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    try:
        event = stripe_service.verify_webhook(payload, request.headers.get("stripe-signature"))
    except Exception as exc:  # noqa: BLE001
        log.warning("stripe webhook rejected: %s", type(exc).__name__)
        raise HTTPException(400, "Invalid webhook signature.") from exc
    if event.get("type") == "checkout.session.completed":
        session = event["data"]["object"]
        booking_id = (session.get("metadata") or {}).get("booking_id")
        if booking_id and session.get("payment_status") == "paid":
            full = await stripe_service.retrieve_session(session["id"])
            await mark_booking_paid(
                booking_id, session_id=session["id"], amount=(session.get("amount_total") or 0) / 100 or None, receipt_url=(full or {}).get("receipt_url")
            )
    return {"received": True}


@router.post("/webhooks/twilio")
async def twilio_webhook(From: str = Form(""), Body: str = Form("")):
    # Twilio signs requests; validate X-Twilio-Signature when TWILIO_AUTH_TOKEN is set.
    await handle_inbound_sms(From, Body)
    return Response(content="<Response></Response>", media_type="application/xml")


@router.post("/demo/inbound-sms")
async def demo_inbound(From: str = Form(...), Body: str = Form(...), move: dict = Depends(current_move)):
    if not get_settings().demo_mode:
        raise HTTPException(404, "Not found")
    q = await handle_inbound_sms(From, Body)
    return to_json(q)
