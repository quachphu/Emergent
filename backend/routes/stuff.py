from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from agents.keep_or_let_go import decide
from agents.matchmaker import best_match_for_item, ensure_item_embedding
from agents.orchestrator import replan, spawn
from agents.schedule import days_left
from agents.vision_inventory import analyze, suggest_decision
from core.db import get_db, insert, new_id, now, to_json
from core.deps import current_move
from core.events import publish
from core.files import file_url, store_image
from models.schemas import DECISIONS, ItemPatch

router = APIRouter(tags=["stuff"])

MAX_FILES = 12


async def _save_media(move: dict, files: list[UploadFile], room_id: str | None, hint: str, source: str) -> list[dict]:
    if not files:
        raise HTTPException(422, "Add at least one photo.")
    if len(files) > MAX_FILES:
        raise HTTPException(422, f"Up to {MAX_FILES} photos at a time.")
    saved = []
    for f in files:
        raw = await f.read()
        try:
            stored = await store_image(raw, move_id=move["_id"], name=f.filename or "photo", kind="scan")
        except ValueError as exc:
            raise HTTPException(422, f"{f.filename}: {exc}") from exc
        media = await insert(
            "scan_media",
            {
                "move_id": move["_id"],
                "file_id": stored["_id"],
                "file": file_url(stored["_id"]),
                "name": f.filename or "photo",
                "room_id": room_id or None,
                "hint": hint or "",
                "source": source,
                "analyzed": False,
                "expire_at": None,
            },
        )
        saved.append(media)
        publish(move["_id"], "scan_media", media)
    return saved


@router.post("/scan/upload")
async def upload(
    files: list[UploadFile] = File(...),
    room_id: str = Form(""),
    hint: str = Form(""),
    source: str = Form("upload"),
    auto_analyze: bool = Form(True),
    move: dict = Depends(current_move),
):
    saved = await _save_media(move, files, room_id, hint, source)
    if auto_analyze:
        spawn(analyze(move, [m["_id"] for m in saved], room_id or None, hint))
    return to_json(saved)


class AnalyzeIn(BaseModel):
    media_ids: list[str]
    room_id: str | None = None
    hint: str = ""


@router.post("/scan/analyze")
async def analyze_route(body: AnalyzeIn, move: dict = Depends(current_move)):
    items = await analyze(move, body.media_ids, body.room_id, body.hint)
    return to_json(items)


@router.get("/scan/media")
async def list_media(move: dict = Depends(current_move)):
    media = [m async for m in get_db().scan_media.find({"move_id": move["_id"]}).sort("created_at", -1).limit(60)]
    return to_json(media)


class CaptureLinkIn(BaseModel):
    room_id: str | None = None


@router.post("/scan/capture-link")
async def capture_link(body: CaptureLinkIn, move: dict = Depends(current_move)):
    token = new_id()
    await insert("capture_tokens", {"_id": token, "move_id": move["_id"], "room_id": body.room_id, "expires_at": now() + timedelta(hours=2)})
    return {"token": token, "path": f"/capture/{token}"}


async def _capture_move(token: str) -> tuple[dict, dict]:
    db = get_db()
    tok = await db.capture_tokens.find_one({"_id": token})
    from core.db import as_utc

    if not tok or as_utc(tok["expires_at"]) < now():
        raise HTTPException(404, "This capture link expired. Make a new QR code on your computer.")
    move = await db.moves.find_one({"_id": tok["move_id"]})
    return tok, move


@router.get("/public/capture/{token}")
async def capture_info(token: str):
    tok, move = await _capture_move(token)
    db = get_db()
    user = await db.users.find_one({"_id": move["user_id"]})
    rooms = [r async for r in db.rooms.find({"move_id": move["_id"]})]
    return {"first_name": (user or {}).get("name", "").split(" ")[0], "room_id": tok.get("room_id"), "rooms": to_json(rooms)}


@router.post("/public/capture/{token}")
async def capture_upload(token: str, files: list[UploadFile] = File(...), room_id: str = Form(""), hint: str = Form("")):
    tok, move = await _capture_move(token)
    saved = await _save_media(move, files, room_id or tok.get("room_id"), hint, "phone")
    spawn(analyze(move, [m["_id"] for m in saved], room_id or tok.get("room_id"), hint))
    return {"received": len(saved)}


# ---------------- items ----------------


@router.get("/items")
async def list_items(room_id: str | None = None, move: dict = Depends(current_move)):
    q: dict = {"move_id": move["_id"], "status": {"$ne": "deleted"}}
    if room_id:
        q["room_id"] = room_id
    items = [i async for i in get_db().items.find(q).sort("created_at", 1)]
    return to_json(items)


@router.get("/items/{item_id}")
async def get_item(item_id: str, move: dict = Depends(current_move)):
    db = get_db()
    item = await db.items.find_one({"_id": item_id, "move_id": move["_id"]})
    if not item:
        raise HTTPException(404, "Item not found.")
    listing = await db.listings.find_one({"item_id": item_id}, sort=[("created_at", -1)])
    matches = []
    async for m in db.matches.find({"item_id": item_id}).sort("score", -1).limit(5):
        m["need"] = to_json(await db.needs.find_one({"_id": m["need_id"]}))
        matches.append(m)
    item_steps = [
        s
        async for s in db.agent_steps.find(
            {
                "move_id": move["_id"],
                "$or": [{"gate.payload.listing_id": listing["_id"] if listing else "-"}, {"title": {"$regex": item["name"], "$options": "i"}}],
            }
        ).sort("created_at", 1)
    ]
    return to_json({**item, "listing": listing, "matches": matches, "steps": item_steps})


@router.patch("/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, move: dict = Depends(current_move)):
    db = get_db()
    item = await db.items.find_one({"_id": item_id, "move_id": move["_id"]})
    if not item:
        raise HTTPException(404, "Item not found.")
    data = body.model_dump(exclude_none=True)
    if data.get("decision") and "decision_reason" not in data:
        data["decision_reason"] = "You chose this."
        data["status"] = data.get("status") or "decided"
    await db.items.update_one({"_id": item_id}, {"$set": {**data, "updated_at": now()}})
    item = await db.items.find_one({"_id": item_id})
    if {"name", "category", "brand_guess", "dims_estimate"} & set(data):
        await ensure_item_embedding(item)
    await replan(move)
    publish(move["_id"], "item", item)
    return to_json(item)


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, move: dict = Depends(current_move)):
    db = get_db()
    res = await db.items.delete_one({"_id": item_id, "move_id": move["_id"]})
    if not res.deleted_count:
        raise HTTPException(404, "Item not found.")
    await db.matches.delete_many({"item_id": item_id})
    await replan(move)
    publish(move["_id"], "item", {"id": item_id, "deleted": True})
    return {"ok": True}


class DecideIn(BaseModel):
    direction: str  # keep | let_go | accept
    decision: str | None = None


@router.post("/items/{item_id}/decide")
async def decide_item(item_id: str, body: DecideIn, move: dict = Depends(current_move)):
    db = get_db()
    item = await db.items.find_one({"_id": item_id, "move_id": move["_id"]})
    if not item:
        raise HTTPException(404, "Item not found.")
    if body.decision:
        if body.decision not in DECISIONS:
            raise HTTPException(422, "Unknown decision.")
        decision, reason = body.decision, "You chose this."
    elif body.direction == "keep":
        decision, reason = "KEEP", "You're keeping it."
    elif body.direction == "accept" and item.get("suggestion"):
        decision, reason = item["suggestion"]["decision"], item["suggestion"]["reason"]
    else:
        sugg = item.get("suggestion") or {}
        if sugg.get("decision") and sugg["decision"] != "KEEP":
            decision, reason = sugg["decision"], sugg["reason"]
        else:
            need, _ = await best_match_for_item(item, move)
            decision, reason, _ = await decide(
                item,
                days_left(move["move_date"]),
                has_match=need is not None,
                priorities=move.get("priorities"),
                move_method=move.get("move_method", "movers"),
                allow_keep=False,
            )
    await db.items.update_one(
        {"_id": item_id},
        {
            "$set": {
                "decision": decision,
                "decision_reason": reason,
                "status": "decided" if item.get("status") in {None, "new", "decided"} else item["status"],
                "decided_at": now(),
            }
        },
    )
    item = await db.items.find_one({"_id": item_id})
    await replan(move)
    publish(move["_id"], "item", item)
    return to_json(item)


@router.post("/items/suggest-all")
async def suggest_all(move: dict = Depends(current_move)):
    db = get_db()
    n = 0
    async for item in db.items.find({"move_id": move["_id"], "decision": None}):
        d, r = await suggest_decision(item, move)
        await db.items.update_one({"_id": item["_id"]}, {"$set": {"suggestion": {"decision": d, "reason": r}}})
        n += 1
    return {"updated": n}


@router.post("/inventory/confirm")
async def confirm_inventory(move: dict = Depends(current_move)):
    db = get_db()
    expire = now() + timedelta(days=7)
    await db.moves.update_one({"_id": move["_id"]}, {"$set": {"inventory_confirmed_at": now()}})
    await db.scan_media.update_many({"move_id": move["_id"], "expire_at": None}, {"$set": {"expire_at": expire}})
    await replan(move)
    return {"ok": True, "raw_media_deleted_after": expire}
