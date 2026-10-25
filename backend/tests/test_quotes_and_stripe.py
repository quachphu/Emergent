import asyncio
import hashlib
import hmac
import json
import time

from agents.vendor_outreach import parse_quote, parse_quote_rules
from core.db import get_db


def test_parse_common_vendor_replies():
    q = parse_quote_rules("Hi! We can take all of it for $210 total, Sat 9–11am. 2 guys + truck, includes disposal fees.")
    assert q.is_quote and q.price == 210 and q.eta and "Sat" in q.eta
    q = parse_quote_rules("Hey this is Junk Bros. $1,185 flat, tomorrow 10am.")
    assert q.price == 1185 and q.eta.lower().startswith("tomorrow")
    q = parse_quote_rules("we'd do it for 180 dollars friday after 2pm")
    assert q.price == 180
    q = parse_quote_rules("Sorry, we're fully booked this week.")
    assert not q.is_quote and q.declined
    q = parse_quote_rules("Can you send photos of the couch?")
    assert not q.is_quote and q.price is None


async def test_parse_quote_falls_back_without_model():
    q, source = await parse_quote("Our quote is $245 all-in. Earliest is Thu 1–3pm.")
    assert q.price == 245 and source == "fallback"


def _sign(payload: bytes, secret: str = "whsec_test_secret") -> str:
    t = int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={t},v1={sig}"


async def _haul_booking(demo):
    c = demo["client"]
    r = await c.post("/api/jobs", json={"type": "haul"})
    assert r.status_code == 200, r.text
    for _ in range(50):
        steps = (await c.get("/api/steps", params={"state": "waiting_for_user"})).json()
        sms = [s for s in steps if s.get("gate", {}) and s["gate"]["handler"] == "send_job_sms"]
        if sms:
            break
        await asyncio.sleep(0.05)
    r = await c.post(f"/api/steps/{sms[0]['id']}/approve")
    assert r.status_code == 200, r.text
    for _ in range(100):
        quotes = [q for j in (await c.get("/api/jobs")).json() for q in j["quotes"] if q["status"] == "open"]
        if len(quotes) >= 3:
            break
        await asyncio.sleep(0.05)
    assert len(quotes) == 3
    r = await c.post(f"/api/quotes/{quotes[0]['id']}/book")
    step = r.json()
    r = await c.post(f"/api/steps/{step['id']}/approve")
    pay = r.json()
    assert pay["state"] == "running", pay
    assert pay["receipt"]["meta"]["checkout"] is True
    return pay["receipt"]["meta"]["booking_id"], quotes[0]


async def test_stripe_webhook_marks_booking_paid_idempotently(demo):
    c = demo["client"]
    booking_id, quote = await _haul_booking(demo)
    before = (await c.get("/api/moves/current/summary")).json()["money"]["spent"]
    event = {
        "id": "evt_1",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_1",
                "object": "checkout.session",
                "payment_status": "paid",
                "amount_total": int(quote["price"] * 100),
                "metadata": {"booking_id": booking_id},
            }
        },
    }
    payload = json.dumps(event).encode()
    r = await c.post("/api/webhooks/stripe", content=payload, headers={"stripe-signature": "t=1,v1=bad"})
    assert r.status_code == 400
    for _ in range(2):  # Stripe may deliver twice
        r = await c.post("/api/webhooks/stripe", content=payload, headers={"stripe-signature": _sign(payload)})
        assert r.status_code == 200, r.text
    b = await get_db().bookings.find_one({"_id": booking_id})
    assert b["status"] == "paid"
    after = (await c.get("/api/moves/current/summary")).json()["money"]["spent"]
    assert after == before + quote["price"]
    steps = (await c.get("/api/steps")).json()
    paid = [s for s in steps if s.get("receipt") and (s["receipt"].get("meta") or {}).get("paid")]
    assert len(paid) == 1 and paid[0]["state"] == "done"
    msgs = [m async for m in get_db().messages.find({"body": {"$regex": "Booking confirmed"}})]
    assert len(msgs) == 1 and "AI assistant" in msgs[0]["body"]


async def test_simulated_checkout_uses_same_handler(demo):
    c = demo["client"]
    booking_id, _ = await _haul_booking(demo)
    r = await c.post(f"/api/bookings/{booking_id}/simulate-pay")
    assert r.status_code == 200 and r.json()["status"] == "paid"
    jobs = (await c.get("/api/jobs")).json()
    assert any(j["status"] == "booked" for j in jobs)


def test_twilio_signature_validation(monkeypatch):
    import base64 as b64
    import hashlib as hl
    import hmac as hm

    from core.config import reset_settings
    from services.sms import valid_twilio_signature

    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "tok")
    reset_settings()
    url, params = "https://example.com/api/webhooks/twilio", {"From": "+15625550141", "Body": "$200 Sat"}
    good = b64.b64encode(hm.new(b"tok", (url + "Body$200 SatFrom+15625550141").encode(), hl.sha1).digest()).decode()
    assert valid_twilio_signature(url, params, good)
    assert not valid_twilio_signature(url, params, "bad")
    assert not valid_twilio_signature(url, params, None)


async def test_inbound_sms_webhook_creates_quote(demo):
    c = demo["client"]
    from core.db import get_db

    await c.post("/api/jobs", json={"type": "haul"})
    for _ in range(50):
        st = [s for s in (await c.get("/api/steps", params={"state": "waiting_for_user"})).json() if s.get("gate") and s["gate"]["handler"] == "send_job_sms"]
        if st:
            break
        await asyncio.sleep(0.05)
    # Mark the job sent without DEMO replies, then post a Twilio-style inbound reply.
    job = await get_db().jobs.find_one({"type": "haul"})
    vendor = await get_db().vendors.find_one({"type": "hauler"})
    await get_db().jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "sent", "vendor_ids": [vendor["_id"]]}})
    r = await c.post("/api/webhooks/twilio", data={"From": vendor["phone"], "Body": "We can do it for $199, Friday after 2pm."})
    assert r.status_code == 200
    q = await get_db().quotes.find_one({"vendor_id": vendor["_id"], "price": 199})
    assert q and q["eta"].lower().startswith("friday")
