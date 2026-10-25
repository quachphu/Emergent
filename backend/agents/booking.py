"""Booking haulers / movers / car shippers: approval → Stripe Checkout → paid (webhook or verify)."""

from __future__ import annotations

import logging

from core.db import get_db, insert, now
from core.events import publish
from services import sms, stripe_service
from services.payouts import payouts_enabled

from . import steps
from .approval import gate_handler, request_approval
from .vendor_outreach import JOB_LABEL

log = logging.getLogger("handoff.booking")

TASK_KEYS = {"haul": ["haul_quotes", "book_hauler"], "mover": ["mover_quotes", "book_movers"], "auto_transport": ["car_decision"]}


async def propose_booking(move: dict, user: dict, quote: dict) -> dict:
    db = get_db()
    job = await db.jobs.find_one({"_id": quote["job_id"]})
    vendor = await db.vendors.find_one({"_id": quote["vendor_id"]})
    existing = await db.agent_steps.find_one(
        {"gate.handler": "pay_quote", "gate.payload.quote_id": quote["_id"], "state": {"$in": ["waiting_for_user", "running"]}}
    )
    if existing:
        return existing
    label = JOB_LABEL[job["type"]]
    preview = (
        f"Pay ${quote['price']:.2f} to {vendor['name']} with Stripe (test mode) for {label.lower()} on {quote.get('eta') or job['package']['time_window']}. "
        f"Then Handoff texts {vendor['name']} the confirmation, marked as sent by an AI assistant on your behalf."
    )
    return await request_approval(
        move["_id"],
        "transport",
        f"Book {vendor['name']} for ${int(quote['price'])}",
        handler="pay_quote",
        payload={"quote_id": quote["_id"]},
        kind="payment",
        preview=preview,
        reason=f"★{vendor.get('rating')} · replied in {quote.get('response_minutes') or 1} min · {quote.get('notes') or ''}".strip(" ·"),
        cta="Approve & pay with Stripe",
        agent="booking",
    )


@gate_handler("pay_quote")
async def _pay(move: dict, step: dict, payload: dict) -> dict:
    db = get_db()
    quote = await db.quotes.find_one({"_id": payload["quote_id"]})
    job = await db.jobs.find_one({"_id": quote["job_id"]})
    vendor = await db.vendors.find_one({"_id": quote["vendor_id"]})
    user = await db.users.find_one({"_id": move["user_id"]})
    booking = await db.bookings.find_one({"quote_id": quote["_id"], "status": {"$in": ["pending", "paid"]}})
    if not booking:
        booking = await insert(
            "bookings",
            {
                "move_id": move["_id"],
                "job_id": job["_id"],
                "quote_id": quote["_id"],
                "vendor_id": vendor["_id"],
                "amount": float(quote["price"]),
                "status": "pending",
                "step_id": step["_id"],
                "stripe_session_id": None,
                "receipt_url": None,
                "payout_status": "pending_connect" if payouts_enabled() else "not_applicable",
            },
        )
    checkout = await stripe_service.create_checkout(
        booking_id=booking["_id"],
        amount=float(quote["price"]),
        description=JOB_LABEL[job["type"]],
        vendor_name=vendor["name"],
        email=user.get("email") if user else None,
    )
    await db.bookings.update_one(
        {"_id": booking["_id"]}, {"$set": {"stripe_session_id": checkout["session_id"], "simulated": checkout["simulated"], "checkout_url": checkout["url"]}}
    )
    note = checkout.get("note") or "Stripe Checkout (test mode). Use card 4242 4242 4242 4242."
    return {
        "keep_running": True,
        "receipt": steps.receipt(
            "payment",
            f"Checkout ready — {note}",
            amount=float(quote["price"]),
            url=checkout["url"],
            data={"booking_id": booking["_id"], "checkout": True, "simulated": checkout["simulated"]},
        ),
    }


async def mark_booking_paid(booking_id: str, *, session_id: str | None = None, amount: float | None = None, receipt_url: str | None = None) -> dict | None:
    """Idempotent: Stripe webhook, return-URL verification and the simulated checkout all land here."""
    db = get_db()
    booking = await db.bookings.find_one({"_id": booking_id})
    if not booking:
        log.warning("paid event for unknown booking")
        return None
    if booking["status"] == "paid":
        return booking
    res = await db.bookings.update_one(
        {"_id": booking_id, "status": {"$ne": "paid"}},
        {
            "$set": {
                "status": "paid",
                "paid_at": now(),
                "stripe_session_id": session_id or booking.get("stripe_session_id"),
                "receipt_url": receipt_url,
                "amount": amount or booking["amount"],
            }
        },
    )
    if res.modified_count == 0:
        return await db.bookings.find_one({"_id": booking_id})
    booking = await db.bookings.find_one({"_id": booking_id})
    quote = await db.quotes.find_one({"_id": booking["quote_id"]})
    job = await db.jobs.find_one({"_id": booking["job_id"]})
    vendor = await db.vendors.find_one({"_id": booking["vendor_id"]})
    move = await db.moves.find_one({"_id": booking["move_id"]})
    user = await db.users.find_one({"_id": move["user_id"]})
    await db.quotes.update_one({"_id": quote["_id"]}, {"$set": {"status": "booked"}})
    await db.quotes.update_many({"job_id": job["_id"], "_id": {"$ne": quote["_id"]}, "status": "open"}, {"$set": {"status": "not_selected"}})
    await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "booked", "booking_id": booking_id}})
    for key in TASK_KEYS.get(job["type"], []):
        await db.tasks.update_one({"move_id": move["_id"], "key": key}, {"$set": {"status": "done"}})
    if job["type"] == "haul":
        await db.items.update_many({"_id": {"$in": job["item_ids"]}}, {"$set": {"status": "haul_booked"}})
    # The approved payment includes confirming with the vendor.
    confirm = sms.disclose(
        f"Booking confirmed and paid (${booking['amount']:.0f}) for {quote.get('eta') or job['package']['time_window']}. See you then!", user["name"]
    )
    result = await sms.send_sms(vendor["phone"], confirm)
    await insert(
        "messages",
        {
            "move_id": move["_id"],
            "direction": "out",
            "channel": "sms",
            "to": vendor["name"],
            "vendor_id": vendor["_id"],
            "body": confirm,
            "status": result["status"],
        },
    )
    step = await db.agent_steps.find_one({"_id": booking.get("step_id")})
    text = f"Paid ${booking['amount']:.2f} to {vendor['name']}{' (simulated test payment)' if booking.get('simulated') else ' via Stripe test mode'}. Vendor notified."
    rec = steps.receipt("payment", text, amount=booking["amount"], url=receipt_url, data={"booking_id": booking_id, "paid": True})
    if step:
        await steps.finish(step, rec)
    else:
        await steps.quick(move["_id"], "transport", f"Booked {vendor['name']}", receipt=rec, agent="booking")
    await insert(
        "documents",
        {
            "move_id": move["_id"],
            "type": "receipt",
            "title": f"{vendor['name']} receipt",
            "summary": text,
            "amount": booking["amount"],
            "url": receipt_url,
            "flags": [],
        },
    )
    publish(move["_id"], "money", {})
    publish(move["_id"], "toast", {"title": "Booked and paid", "body": text})
    return booking
