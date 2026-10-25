from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agents import steps
from agents.orchestrator import replan, summary
from core.db import get_db, insert, now, to_json
from core.deps import current_move, current_user
from models.schemas import MoveIn, MovePatch
from services.geo import area_label, city_of, geocode

router = APIRouter(tags=["moves"])

DEFAULT_ROOMS = ["Living room", "Bedroom", "Kitchen", "Office"]


class GeocodeIn(BaseModel):
    address: str


@router.post("/geo/geocode")
async def geocode_route(body: GeocodeIn):
    result = await geocode(body.address)
    if not result:
        return {"found": False}
    return {"found": True, **result}


async def _geo_fields(prefix: str, address: str | None, given) -> dict:
    if not address:
        return {}
    res = await geocode(address)
    geo = given.model_dump() if given else (res["geo"] if res else None)
    city = city_of(res, address)
    out = {f"{prefix}_geo": geo}
    if prefix in {"from", "to"}:
        out[f"{prefix}_city"] = city
        out[f"{prefix}_area"] = area_label(address, city)
    return out


@router.post("/moves")
async def create_move(body: MoveIn, user: dict = Depends(current_user)):
    db = get_db()
    data = body.model_dump(exclude={"from_geo", "to_geo", "work_geo"})
    data |= await _geo_fields("from", body.from_address, body.from_geo)
    data |= await _geo_fields("to", body.to_address, body.to_geo)
    data |= await _geo_fields("work", body.work_address, body.work_geo)
    existing = await db.moves.find_one({"user_id": user["_id"]})
    if existing:
        await db.moves.update_one({"_id": existing["_id"]}, {"$set": {**data, "updated_at": now()}})
        move = await db.moves.find_one({"_id": existing["_id"]})
    else:
        move = await insert("moves", {"user_id": user["_id"], **data, "onboarded": False})
        for name in DEFAULT_ROOMS:
            await insert("rooms", {"move_id": move["_id"], "name": name})
    tasks = await replan(move)
    await steps.quick(
        move["_id"],
        "stuff",
        f"Built your plan: {len(tasks)} dated tasks across 5 lanes",
        reason="Everything is scheduled backward from move day.",
        receipt=steps.receipt("plan", f"Move day {move['move_date']}. {move.get('from_city') or 'Here'} → {move.get('to_city') or 'there'}."),
    )
    return to_json(move)


@router.get("/moves/current")
async def get_move(move: dict = Depends(current_move)):
    return to_json(move)


@router.patch("/moves/current")
async def patch_move(body: MovePatch, move: dict = Depends(current_move)):
    db = get_db()
    data = body.model_dump(exclude_none=True)
    if "from_address" in data:
        data |= await _geo_fields("from", data["from_address"], None)
    if "to_address" in data:
        data |= await _geo_fields("to", data["to_address"], None)
    if "work_address" in data:
        data |= await _geo_fields("work", data["work_address"], None)
    if "priorities" in data and hasattr(body.priorities, "model_dump"):
        data["priorities"] = body.priorities.model_dump()
    await db.moves.update_one({"_id": move["_id"]}, {"$set": {**data, "updated_at": now()}})
    move = await db.moves.find_one({"_id": move["_id"]})
    if set(data) - {"onboarded", "updated_at"}:
        await replan(move)
    return to_json(move)


@router.get("/moves/current/summary")
async def get_summary(move: dict = Depends(current_move)):
    return to_json(await summary(move))


@router.get("/rooms")
async def list_rooms(move: dict = Depends(current_move)):
    rooms = [r async for r in get_db().rooms.find({"move_id": move["_id"]}).sort("created_at", 1)]
    return to_json(rooms)


class RoomIn(BaseModel):
    name: str


@router.post("/rooms")
async def add_room(body: RoomIn, move: dict = Depends(current_move)):
    if not body.name.strip():
        raise HTTPException(422, "Room name is required.")
    room = await insert("rooms", {"move_id": move["_id"], "name": body.name.strip()[:40]})
    return to_json(room)
