import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents import approval, steps
from agents.approval import ApprovalRequired
from agents.orchestrator import execute_run, propose_run, replan, run_action, spawn
from core.db import get_db, now, to_json
from core.deps import current_move, current_user, current_user_query, move_for_user
from core.events import subscribe, unsubscribe
from models.schemas import ActionPatch, TaskPatch

router = APIRouter(tags=["plan"])


@router.get("/tasks")
async def list_tasks(lane: str | None = None, move: dict = Depends(current_move)):
    q: dict = {"move_id": move["_id"]}
    if lane:
        q["lane"] = lane
    tasks = [t async for t in get_db().tasks.find(q).sort("due_date", 1)]
    return to_json(tasks)


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: str, body: TaskPatch, move: dict = Depends(current_move)):
    db = get_db()
    data = body.model_dump(exclude_none=True)
    res = await db.tasks.update_one({"_id": task_id, "move_id": move["_id"]}, {"$set": {**data, "updated_at": now()}})
    if not res.matched_count:
        raise HTTPException(404, "Task not found.")
    task = await db.tasks.find_one({"_id": task_id})
    if task["key"] == "notice_to_vacate" and data.get("status") == "done":
        await db.moves.update_one({"_id": move["_id"]}, {"$set": {"notice_sent": True}})
    # Resolve "do it yourself" steps tied to this task.
    if data.get("status") == "done":
        async for st in db.agent_steps.find({"task_id": task_id, "state": "waiting_for_user", "gate": None}):
            await steps.finish(st, steps.receipt("note", "You marked this done."))
    await replan(move)
    return to_json(task)


@router.post("/plan/replan")
async def replan_route(move: dict = Depends(current_move)):
    tasks = await replan(move)
    return {"tasks": len(tasks)}


# ---------------- runs ----------------


@router.post("/runs/propose")
async def propose(move: dict = Depends(current_move), user: dict = Depends(current_user)):
    return to_json(await propose_run(move, user))


@router.get("/runs/current")
async def current_run(move: dict = Depends(current_move)):
    run = await get_db().runs.find_one({"move_id": move["_id"]}, sort=[("created_at", -1)])
    return to_json(run)


@router.patch("/runs/{run_id}/actions/{action_id}")
async def edit_action(run_id: str, action_id: str, body: ActionPatch, move: dict = Depends(current_move)):
    db = get_db()
    run = await db.runs.find_one({"_id": run_id, "move_id": move["_id"]})
    if not run or run["status"] != "proposed":
        raise HTTPException(409, "This plan already started.")
    for a in run["actions"]:
        if a["id"] == action_id:
            if body.title is not None:
                a["title"] = body.title.strip()[:120] or a["title"]
            if body.enabled is not None:
                a["enabled"] = body.enabled
            if body.params:
                a["params"] = {**a["params"], **{k: v for k, v in body.params.items() if k in {"start_price"}}}
    await db.runs.update_one({"_id": run_id}, {"$set": {"actions": run["actions"]}})
    return to_json(await db.runs.find_one({"_id": run_id}))


@router.post("/runs/{run_id}/approve")
async def approve_run(run_id: str, move: dict = Depends(current_move)):
    db = get_db()
    res = await db.runs.update_one({"_id": run_id, "move_id": move["_id"], "status": "proposed"}, {"$set": {"status": "running", "approved_at": now()}})
    if not res.modified_count:
        raise HTTPException(409, "This plan already started.")
    spawn(execute_run(run_id))
    return to_json(await db.runs.find_one({"_id": run_id}))


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, move: dict = Depends(current_move)):
    await get_db().runs.update_one({"_id": run_id, "move_id": move["_id"], "status": "running"}, {"$set": {"status": "paused"}})
    return to_json(await get_db().runs.find_one({"_id": run_id}))


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, move: dict = Depends(current_move)):
    await get_db().runs.update_one({"_id": run_id, "move_id": move["_id"], "status": "paused"}, {"$set": {"status": "running"}})
    return to_json(await get_db().runs.find_one({"_id": run_id}))


# ---------------- steps ----------------


@router.get("/steps")
async def list_steps(lane: str | None = None, run_id: str | None = None, state: str | None = None, limit: int = 100, move: dict = Depends(current_move)):
    q: dict = {"move_id": move["_id"]}
    if lane:
        q["lane"] = lane
    if run_id:
        q["run_id"] = run_id
    if state:
        q["state"] = state
    items = [s async for s in get_db().agent_steps.find(q).sort("created_at", -1).limit(min(limit, 300))]
    items.reverse()
    return to_json(items)


async def _own_step(step_id: str, move: dict) -> dict:
    st = await get_db().agent_steps.find_one({"_id": step_id, "move_id": move["_id"]})
    if not st:
        raise HTTPException(404, "Step not found.")
    return st


class ApproveIn(BaseModel):
    message: str | None = None  # user-edited outbound message


@router.post("/steps/{step_id}/approve")
async def approve_step(step_id: str, body: ApproveIn | None = None, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    st = await _own_step(step_id, move)
    overrides = None
    if body and body.message and st.get("gate", {}).get("payload", {}).get("message") is not None:
        from services.sms import disclose

        overrides = {"message": disclose(body.message.strip(), user["name"])}
    try:
        return to_json(await approval.approve(step_id, user, overrides))
    except (ValueError, ApprovalRequired) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/steps/{step_id}/reject")
async def reject_step(step_id: str, move: dict = Depends(current_move)):
    await _own_step(step_id, move)
    return to_json(await approval.reject(step_id))


@router.post("/steps/{step_id}/takeover")
async def takeover_step(step_id: str, move: dict = Depends(current_move)):
    await _own_step(step_id, move)
    return to_json(await approval.take_over(step_id))


@router.post("/steps/{step_id}/undo")
async def undo_step(step_id: str, move: dict = Depends(current_move)):
    await _own_step(step_id, move)
    try:
        return to_json(await approval.undo(step_id))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/steps/{step_id}/complete")
async def complete_step(step_id: str, move: dict = Depends(current_move)):
    st = await _own_step(step_id, move)
    if st.get("gate"):
        raise HTTPException(409, "Use approve for this step.")
    if st.get("task_id"):
        await get_db().tasks.update_one({"_id": st["task_id"]}, {"$set": {"status": "done"}})
    if st.get("link") == "/old-home":
        await get_db().moves.update_one({"_id": move["_id"]}, {"$set": {"notice_sent": True}})
    done = await steps.finish(st, steps.receipt("note", "You marked this done."))
    await replan(move)
    return to_json(done)


@router.post("/steps/{step_id}/retry")
async def retry_step(step_id: str, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    st = await _own_step(step_id, move)
    if st["state"] != "failed":
        raise HTTPException(409, "Only failed steps can be retried.")
    if st.get("gate"):
        await get_db().agent_steps.update_one({"_id": step_id}, {"$set": {"gate.executed_at": None}})
        return to_json(await approval.run_gated(step_id))
    run = await get_db().runs.find_one({"_id": st.get("run_id")}) if st.get("run_id") else None
    action = next((a for a in (run or {}).get("actions", []) if a["id"] == st.get("action_id")), None)
    if not action:
        raise HTTPException(409, "Nothing to retry for this step.")
    await steps.finish(st, steps.receipt("note", "Retrying…"))
    spawn(run_action(move, user, action, st.get("run_id")))
    return {"ok": True}


# ---------------- live stream ----------------


@router.get("/stream")
async def stream(request: Request, user: dict = Depends(current_user_query)):
    move = await move_for_user(user)
    q = subscribe(move["_id"])

    async def gen():
        try:
            yield "retry: 3000\n\n"
            yield 'data: {"type":"hello"}\n\n'
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {msg}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            unsubscribe(move["_id"], q)

    return StreamingResponse(
        gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    )


@router.get("/inbox")
async def inbox(move: dict = Depends(current_move)):
    db = get_db()
    waiting = [s async for s in db.agent_steps.find({"move_id": move["_id"], "state": "waiting_for_user"}).sort("created_at", 1)]
    requests = []
    async for li in db.listings.find({"move_id": move["_id"]}):
        for r in li.get("interest_requests", []):
            if r["status"] == "new":
                requests.append({**r, "listing_id": li["_id"], "listing_title": li["title"]})
    messages = [m async for m in db.messages.find({"move_id": move["_id"]}).sort("created_at", -1).limit(40)]
    return to_json({"waiting": waiting, "requests": requests, "messages": messages})
