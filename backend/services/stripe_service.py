"""Stripe Checkout (test mode) for booking haulers and movers — the only thing Stripe is used for.

Without a key (or if Stripe can't be reached) the app uses an in-app simulated checkout that ends
in the same idempotent `agents.booking.mark_booking_paid` handler as the real webhook.
"""

from __future__ import annotations

import asyncio
import logging
import time

import stripe

from core.config import get_settings

log = logging.getLogger("handoff.stripe")
_down_until = 0.0


def status() -> dict:
    s = get_settings()
    mode = "test" if s.stripe_secret_key.startswith(("sk_test", "rk_test")) else ("live" if s.stripe_secret_key else "simulated")
    return {
        "provider": "stripe" if s.stripe_enabled else "simulated",
        "live": s.stripe_enabled and time.time() >= _down_until,
        "mode": mode,
        "webhook": bool(s.stripe_webhook_secret),
    }


def _client() -> stripe.StripeClient:
    return stripe.StripeClient(get_settings().stripe_secret_key, max_network_retries=1)


async def create_checkout(*, booking_id: str, amount: float, description: str, vendor_name: str, email: str | None) -> dict:
    """Returns {"url", "session_id", "simulated": bool, "note"}."""
    global _down_until
    s = get_settings()
    base = s.frontend_url
    simulated = {"url": f"/checkout/{booking_id}", "session_id": f"sim_{booking_id}", "simulated": True}
    if not s.stripe_enabled or time.time() < _down_until:
        return simulated | {"note": "Stripe not configured — simulated test checkout."}
    params = {
        "mode": "payment",
        "line_items": [
            {
                "quantity": 1,
                "price_data": {"currency": "usd", "unit_amount": int(round(amount * 100)), "product_data": {"name": f"{vendor_name} — {description}"}},
            }
        ],
        "success_url": f"{base}/transport?booking={booking_id}&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/transport?booking={booking_id}&cancelled=1",
        "metadata": {"booking_id": booking_id},
        "payment_intent_data": {"metadata": {"booking_id": booking_id}},
    }
    if email:
        params["customer_email"] = email
    try:
        session = await asyncio.to_thread(lambda: _client().checkout.sessions.create(params=params))
        return {"url": session.url, "session_id": session.id, "simulated": False}
    except Exception as exc:  # noqa: BLE001
        log.warning("stripe checkout unavailable (%s); using simulated checkout", type(exc).__name__)
        _down_until = time.time() + 60
        return simulated | {"note": "Stripe unreachable — simulated test checkout."}


async def retrieve_session(session_id: str) -> dict | None:
    if session_id.startswith("sim_") or not get_settings().stripe_enabled:
        return None
    try:
        session = await asyncio.to_thread(lambda: _client().checkout.sessions.retrieve(session_id, params={"expand": ["payment_intent.latest_charge"]}))
    except Exception as exc:  # noqa: BLE001
        log.warning("stripe retrieve failed: %s", type(exc).__name__)
        return None
    return session_to_dict(session)


def session_to_dict(session) -> dict:
    d = session.to_dict() if hasattr(session, "to_dict") else dict(session)
    receipt_url = None
    pi = d.get("payment_intent")
    if isinstance(pi, dict):
        charge = pi.get("latest_charge")
        if isinstance(charge, dict):
            receipt_url = charge.get("receipt_url")
    return {
        "id": d.get("id"),
        "payment_status": d.get("payment_status"),
        "amount_total": (d.get("amount_total") or 0) / 100,
        "metadata": d.get("metadata") or {},
        "receipt_url": receipt_url,
    }


def verify_webhook(payload: bytes, sig_header: str | None) -> dict:
    secret = get_settings().stripe_webhook_secret
    if not secret:
        raise ValueError("STRIPE_WEBHOOK_SECRET is not set")
    event = stripe.Webhook.construct_event(payload, sig_header or "", secret)
    return event.to_dict() if hasattr(event, "to_dict") else dict(event)
