"""Twilio SMS via REST. Runs in simulated mode when any Twilio variable is missing.

Every outbound message must already carry the AI disclosure (see `disclose`)."""

from __future__ import annotations

import logging

import httpx

from core.config import get_settings

log = logging.getLogger("handoff.sms")

DISCLOSURE = "Sent by Handoff, an AI assistant, on behalf of"


def disclose(body: str, user_name: str) -> str:
    tag = f"[{DISCLOSURE} {user_name}]"
    return body if DISCLOSURE in body else f"{tag} {body}"


async def send_sms(to: str, body: str) -> dict:
    """Returns {"status": "sent"|"simulated"|"failed", "sid": ..., "error": ...}."""
    if DISCLOSURE not in body:
        raise ValueError("Outbound messages must include the AI assistant disclosure.")
    s = get_settings()
    if not s.twilio_enabled:
        return {"status": "simulated", "sid": None}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{s.twilio_sid}/Messages.json",
                data={"To": to, "From": s.twilio_from, "Body": body},
                auth=(s.twilio_sid, s.twilio_token),
            )
            resp.raise_for_status()
            return {"status": "sent", "sid": resp.json().get("sid")}
    except Exception as exc:  # noqa: BLE001
        log.warning("twilio send failed: %s", type(exc).__name__)
        return {"status": "failed", "sid": None, "error": "SMS provider unavailable"}


def status() -> dict:
    s = get_settings()
    return {"provider": "twilio" if s.twilio_enabled else "simulated", "live": s.twilio_enabled}
