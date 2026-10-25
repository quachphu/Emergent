"""The approval gate.

Every outbound action — a message to a person or business, a booking, a payment, a submission —
goes through `request_approval()`, which parks a `waiting_for_user` step holding the action.
Only `approve()` (called from the UI) runs it, via `run_gated()`, the single function that is
allowed to invoke outbound handlers. Handlers are registered with `@gate_handler(name)`.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from core.db import get_db, now
from core.events import publish

from . import steps

log = logging.getLogger("handoff.approval")

GATE_KINDS = {"message", "booking", "payment", "submission", "approval"}

Handler = Callable[[dict, dict, dict], Awaitable[dict | None]]
HANDLERS: dict[str, Handler] = {}
UNDO_HANDLERS: dict[str, Handler] = {}


class ApprovalRequired(PermissionError):
    pass


def gate_handler(name: str):
    def deco(fn: Handler) -> Handler:
        HANDLERS[name] = fn
        return fn

    return deco


def undo_handler(name: str):
    def deco(fn: Handler) -> Handler:
        UNDO_HANDLERS[name] = fn
        return fn

    return deco


async def request_approval(
    move_id: str,
    lane: str,
    title: str,
    *,
    handler: str,
    payload: dict,
    kind: str,
    preview: str = "",
    reason: str = "",
    cta: str = "Approve",
    task_id: str | None = None,
    run_id: str | None = None,
    action_id: str | None = None,
    step: dict | None = None,
    agent: str = "orchestrator",
) -> dict:
    if kind not in GATE_KINDS:
        raise ValueError(f"unknown gate kind {kind}")
    if handler not in HANDLERS:
        raise ValueError(f"no handler registered for {handler}")
    gate = {
        "kind": kind,
        "handler": handler,
        "payload": payload,
        "preview": preview,
        "cta": cta,
        "approved": False,
        "requested_at": now(),
    }
    if step is None:
        step = await steps.create_step(
            move_id,
            lane,
            title,
            state="waiting_for_user",
            reason=reason,
            task_id=task_id,
            run_id=run_id,
            action_id=action_id,
            agent=agent,
        )
    step = await steps.update_step(step["_id"], state="waiting_for_user", gate=gate, title=title, reason=reason or step.get("reason", ""))
    if task_id:
        await get_db().tasks.update_one({"_id": task_id, "status": {"$nin": ["done", "skipped"]}}, {"$set": {"status": "waiting_for_user"}})
    publish(move_id, "inbox", {"step_id": step["_id"]})
    return step


async def run_gated(step_id: str) -> dict:
    """The only path to outbound handlers. Refuses unless the user approved this exact step."""
    db = get_db()
    step = await db.agent_steps.find_one({"_id": step_id})
    if not step or not step.get("gate"):
        raise ValueError("Step has no gated action.")
    gate = step["gate"]
    if not gate.get("approved"):
        raise ApprovalRequired("This action needs your approval first.")
    if gate.get("executed_at"):
        return step  # idempotent
    move = await db.moves.find_one({"_id": step["move_id"]})
    step = await steps.update_step(step_id, state="running")
    handler = HANDLERS[gate["handler"]]
    try:
        result = await handler(move, step, gate.get("payload") or {})
    except Exception as exc:  # noqa: BLE001
        log.exception("gated handler %s failed", gate["handler"])
        return await steps.fail(step, f"{type(exc).__name__}: could not complete. You can retry.")
    result = result or {}
    fields: dict = {"gate.executed_at": now()}
    if result.get("undo"):
        fields["undo"] = result["undo"]
    await db.agent_steps.update_one({"_id": step_id}, {"$set": fields})
    if result.get("keep_running"):
        # Handler continues asynchronously (e.g. waiting for vendor replies or Stripe).
        return await steps.update_step(step_id, state="running", receipt=result.get("receipt"))
    return await steps.finish(step, result.get("receipt"))


async def approve(step_id: str, user: dict, payload_overrides: dict | None = None) -> dict:
    db = get_db()
    step = await db.agent_steps.find_one({"_id": step_id})
    if not step or not step.get("gate"):
        raise ValueError("Nothing to approve on this step.")
    if step["state"] not in {"waiting_for_user", "failed"}:
        return step
    update: dict = {"gate.approved": True, "gate.approved_at": now(), "gate.approved_by": user["_id"]}
    if payload_overrides:
        for k, v in payload_overrides.items():
            update[f"gate.payload.{k}"] = v
    await db.agent_steps.update_one({"_id": step_id}, {"$set": update})
    publish(step["move_id"], "inbox", {"step_id": step_id})
    return await run_gated(step_id)


async def reject(step_id: str) -> dict:
    db = get_db()
    step = await db.agent_steps.find_one({"_id": step_id})
    if not step:
        raise ValueError("Step not found.")
    await db.agent_steps.update_one({"_id": step_id}, {"$set": {"gate.declined": True}})
    publish(step["move_id"], "inbox", {"step_id": step_id})
    return await steps.finish(step, steps.receipt("note", "You declined — nothing was sent."), declined=True)


async def take_over(step_id: str) -> dict:
    db = get_db()
    step = await db.agent_steps.find_one({"_id": step_id})
    if not step:
        raise ValueError("Step not found.")
    if step.get("task_id"):
        await db.tasks.update_one({"_id": step["task_id"]}, {"$set": {"status": "in_progress", "owner": "user"}})
    publish(step["move_id"], "inbox", {"step_id": step_id})
    return await steps.finish(step, steps.receipt("note", "You took over this step. Handoff won't act on it."), taken_over=True)


async def undo(step_id: str) -> dict:
    db = get_db()
    step = await db.agent_steps.find_one({"_id": step_id})
    if not step or not step.get("undo"):
        raise ValueError("This step can't be undone.")
    info = step["undo"]
    fn = UNDO_HANDLERS.get(info["handler"])
    if not fn:
        raise ValueError("This step can't be undone.")
    move = await db.moves.find_one({"_id": step["move_id"]})
    await fn(move, step, info.get("payload") or {})
    return await steps.update_step(step_id, undo=None, undone=True, receipt=steps.receipt("note", "Undone. " + (info.get("label") or "")))


async def pending(move_id: str) -> list[dict]:
    cur = get_db().agent_steps.find({"move_id": move_id, "state": "waiting_for_user"}).sort("created_at", 1)
    return [s async for s in cur]
