from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agents.listing_pricing import add_interest, create_listing, mark_sold, propose_interest_reply, schedule_text
from agents.matchmaker import accept_window, ensure_need_embedding, propose_offer, run_matching
from agents.schedule import price_schedule
from core.db import get_db, insert, now, to_json
from core.deps import current_move, current_user
from core.events import publish
from models.schemas import InterestIn, NeedIn
from services.geo import gazetteer_lookup

router = APIRouter(tags=["sell"])

MARKETPLACES = [
    {"name": "Facebook Marketplace", "url": "https://www.facebook.com/marketplace/create/item"},
    {"name": "Craigslist", "url": "https://post.craigslist.org/"},
    {"name": "OfferUp", "url": "https://offerup.com/post"},
]


async def _listing_out(li: dict) -> dict:
    item = await get_db().items.find_one({"_id": li["item_id"]})
    return {**to_json(li), "item": to_json(item), "schedule_text": schedule_text(li), "marketplaces": MARKETPLACES}


@router.get("/listings")
async def list_listings(move: dict = Depends(current_move)):
    out = []
    async for li in get_db().listings.find({"move_id": move["_id"]}).sort("created_at", -1):
        out.append(await _listing_out(li))
    return out


class ListingCreate(BaseModel):
    start_price: float | None = None


@router.post("/items/{item_id}/listing")
async def create_listing_route(item_id: str, body: ListingCreate, move: dict = Depends(current_move)):
    item = await get_db().items.find_one({"_id": item_id, "move_id": move["_id"]})
    if not item:
        raise HTTPException(404, "Item not found.")
    return await _listing_out(await create_listing(move, item, start_price=body.start_price))


class ListingPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    start_price: float | None = None


@router.patch("/listings/{listing_id}")
async def patch_listing(listing_id: str, body: ListingPatch, move: dict = Depends(current_move)):
    db = get_db()
    li = await db.listings.find_one({"_id": listing_id, "move_id": move["_id"]})
    if not li:
        raise HTTPException(404, "Listing not found.")
    data = body.model_dump(exclude_none=True)
    if "start_price" in data:
        sched = price_schedule(data.pop("start_price"), move["move_date"])
        data["price_schedule"] = [p.__dict__ for p in sched.points]
        data["current_price"] = sched.points[0].price
    await db.listings.update_one({"_id": listing_id}, {"$set": data})
    return await _listing_out(await db.listings.find_one({"_id": listing_id}))


class SoldIn(BaseModel):
    price: float


@router.post("/listings/{listing_id}/sold")
async def sold(listing_id: str, body: SoldIn, move: dict = Depends(current_move)):
    li = await get_db().listings.find_one({"_id": listing_id, "move_id": move["_id"]})
    if not li:
        raise HTTPException(404, "Listing not found.")
    return await _listing_out(await mark_sold(move, li, body.price))


@router.post("/listings/{listing_id}/interest/{request_id}/accept")
async def accept_interest(listing_id: str, request_id: str, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    li = await get_db().listings.find_one({"_id": listing_id, "move_id": move["_id"]})
    if not li or not any(r["id"] == request_id for r in li["interest_requests"]):
        raise HTTPException(404, "Request not found.")
    await get_db().listings.update_one({"_id": listing_id, "interest_requests.id": request_id}, {"$set": {"interest_requests.$.status": "pending_reply"}})
    return to_json(await propose_interest_reply(move, user, li, request_id))


# ---------------- public listing page ----------------


@router.get("/public/listings/{slug}")
async def public_listing(slug: str):
    db = get_db()
    li = await db.listings.find_one({"public_slug": slug, "status": {"$in": ["active", "sold"]}})
    if not li:
        raise HTTPException(404, "This listing isn't available.")
    item = await db.items.find_one({"_id": li["item_id"]})
    move = await db.moves.find_one({"_id": li["move_id"]})
    user = await db.users.find_one({"_id": move["user_id"]})
    from agents.matchmaker import pickup_windows

    return {
        "title": li["title"],
        "description": li["description"],
        "price": li["current_price"],
        "status": li["status"],
        "photos": item.get("photos") or [],
        "condition": item.get("condition"),
        "dims": item.get("dims_estimate"),
        "name": item.get("name"),
        "pickup_area": li.get("pickup_area"),
        "pickup_windows": pickup_windows(move["move_date"]),
        "seller_first_name": user["name"].split(" ")[0],
        "price_schedule": li["price_schedule"],
        "value_label": "Estimate based on similar items.",
        "payment_note": "Pay the seller in person at pickup.",
    }


@router.post("/public/listings/{slug}/interest")
async def public_interest(slug: str, body: InterestIn):
    li = await get_db().listings.find_one({"public_slug": slug, "status": "active"})
    if not li:
        raise HTTPException(404, "This listing isn't available.")
    await add_interest(li, body.name, body.contact, body.proposed_time, body.message)
    return {"ok": True, "message": "Sent! The seller will confirm your pickup time."}


# ---------------- handoff board ----------------


@router.get("/public/needs")
async def public_needs(city: str | None = None):
    q: dict = {}
    if city:
        q["city"] = {"$regex": city, "$options": "i"}
    needs = [n async for n in get_db().needs.find(q).sort("created_at", -1).limit(100)]
    for n in needs:
        n.pop("contact", None)
    return to_json(needs)


@router.post("/public/needs")
async def post_need(body: NeedIn):
    geo = gazetteer_lookup(f"{body.neighborhood or ''} {body.city}")
    need = await insert("needs", {**body.model_dump(), "status": "open", "location": geo["geo"] if geo else None})
    await ensure_need_embedding(need)
    db = get_db()
    async for move in db.moves.find({}):
        if move.get("from_city") and body.city.lower() in move["from_city"].lower():
            await run_matching(move)
            publish(move["_id"], "toast", {"title": "New arrival need", "body": f"{body.arrival_name} is looking for {body.item_wanted}."})
    return {"ok": True, "id": need["_id"]}


@router.get("/matches")
async def list_matches(move: dict = Depends(current_move)):
    db = get_db()
    await run_matching(move)
    out = []
    async for m in db.matches.find({"move_id": move["_id"]}).sort("score", -1):
        m["item"] = to_json(await db.items.find_one({"_id": m["item_id"]}))
        need = await db.needs.find_one({"_id": m["need_id"]})
        if need:
            need.pop("contact", None)
        m["need"] = to_json(need)
        if m["item"] and m["need"]:
            out.append(m)
    return to_json(out)


@router.post("/matches/{match_id}/offer")
async def offer(match_id: str, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    db = get_db()
    m = await db.matches.find_one({"_id": match_id, "move_id": move["_id"]})
    if not m:
        raise HTTPException(404, "Match not found.")
    item = await db.items.find_one({"_id": m["item_id"]})
    need = await db.needs.find_one({"_id": m["need_id"]})
    if item.get("decision") != "HANDOFF":
        await db.items.update_one({"_id": item["_id"]}, {"$set": {"decision": "HANDOFF", "decision_reason": f"{need['arrival_name']} needs it."}})
    task = await db.tasks.find_one({"move_id": move["_id"], "key": f"handoff:{item['_id']}"})
    return to_json(await propose_offer(move, user, item, m, need, task_id=task["_id"] if task else None))


@router.get("/public/matches/{match_id}")
async def public_match(match_id: str, t: str):
    db = get_db()
    m = await db.matches.find_one({"_id": match_id, "token": t})
    if not m or m["status"] not in {"offered", "accepted"}:
        raise HTTPException(404, "This offer isn't available.")
    item = await db.items.find_one({"_id": m["item_id"]})
    move = await db.moves.find_one({"_id": m["move_id"]})
    return {
        "item": item["name"],
        "photos": item.get("photos") or [],
        "pickup_windows": m.get("pickup_windows"),
        "area": move.get("from_area"),
        "status": m["status"],
        "pickup_window": m.get("pickup_window"),
    }


class AcceptIn(BaseModel):
    window: str


@router.post("/public/matches/{match_id}/accept")
async def public_accept(match_id: str, t: str, body: AcceptIn):
    db = get_db()
    m = await db.matches.find_one({"_id": match_id, "token": t, "status": "offered"})
    if not m or body.window not in (m.get("pickup_windows") or []):
        raise HTTPException(404, "This offer isn't available.")
    await accept_window(match_id, body.window)
    return {"ok": True, "accepted_at": now()}
