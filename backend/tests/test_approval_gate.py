import pytest

from agents import approval, steps
from agents.approval import ApprovalRequired, gate_handler
from core.db import get_db, insert

CALLS = []


@gate_handler("test_send")
async def _test_send(move, step, payload):
    CALLS.append(payload)
    return {"receipt": steps.receipt("sms", "sent")}


async def _move():
    user = await insert("users", {"name": "T", "email": "t@x.com"})
    return user, await insert("moves", {"user_id": user["_id"], "move_date": "2030-01-01"})


async def test_outbound_waits_for_user():
    CALLS.clear()
    user, move = await _move()
    st = await approval.request_approval(move["_id"], "stuff", "Text vendor", handler="test_send", payload={"x": 1}, kind="message", preview="hi")
    assert st["state"] == "waiting_for_user"
    assert CALLS == []
    with pytest.raises(ApprovalRequired):
        await approval.run_gated(st["_id"])
    assert CALLS == []


async def test_approve_runs_handler_once():
    CALLS.clear()
    user, move = await _move()
    st = await approval.request_approval(move["_id"], "stuff", "Text vendor", handler="test_send", payload={"x": 1}, kind="message")
    done = await approval.approve(st["_id"], user)
    assert done["state"] == "done" and done["receipt"]["text"] == "sent"
    await approval.run_gated(st["_id"])  # idempotent
    await approval.approve(st["_id"], user)
    assert CALLS == [{"x": 1}]


async def test_reject_never_runs():
    CALLS.clear()
    user, move = await _move()
    st = await approval.request_approval(move["_id"], "stuff", "Pay", handler="test_send", payload={}, kind="payment")
    out = await approval.reject(st["_id"])
    assert out["state"] == "done" and out["declined"] is True
    with pytest.raises(ApprovalRequired):
        await approval.run_gated(st["_id"])
    assert CALLS == []


async def test_unknown_kind_or_handler_rejected():
    user, move = await _move()
    with pytest.raises(ValueError):
        await approval.request_approval(move["_id"], "stuff", "x", handler="test_send", payload={}, kind="email-blast")
    with pytest.raises(ValueError):
        await approval.request_approval(move["_id"], "stuff", "x", handler="nope", payload={}, kind="message")


async def test_every_registered_outbound_handler_is_gated():
    # All real outbound actions are registered gate handlers (they can only run through run_gated).
    import server  # noqa: F401

    for name in ["send_job_sms", "pay_quote", "send_handoff_offer", "book_city_pickup", "confirm_buyer", "activate_listing"]:
        assert name in approval.HANDLERS


async def test_sms_requires_ai_disclosure():
    from services.sms import disclose, send_sms

    with pytest.raises(ValueError):
        await send_sms("+15555550100", "Hello there")
    msg = disclose("Hello there", "Maya")
    assert "AI assistant" in msg and "Maya" in msg
    assert (await send_sms("+15555550100", msg))["status"] == "simulated"
    assert await get_db().agent_steps.count_documents({}) == 0
