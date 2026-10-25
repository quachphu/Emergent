from fastapi import APIRouter, Depends

from core.db import get_db
from core.deps import current_move
from data.city_rules import DONATION_SITES
from services.geo import _jitter

router = APIRouter(tags=["map"])


def _pt(geo):
    return geo["coordinates"] if geo and geo.get("coordinates") else None


@router.get("/map/pins")
async def pins(move: dict = Depends(current_move)):
    db = get_db()
    out = []
    home = _pt(move.get("from_geo"))
    if home:
        out.append({"id": "home-from", "kind": "home", "lng": home[0], "lat": home[1], "title": "Your place now", "subtitle": move.get("from_area")})
    new = _pt(move.get("to_geo"))
    if new:
        out.append({"id": "home-to", "kind": "home", "lng": new[0], "lat": new[1], "title": "New place", "subtitle": move.get("to_area")})
    async for li in db.listings.find({"move_id": move["_id"], "status": "active"}):
        item = await db.items.find_one({"_id": li["item_id"]})
        if not home or not item:
            continue
        dx, dy = _jitter(item["_id"], 0.004)
        out.append(
            {
                "id": f"sale-{li['_id']}",
                "kind": "sale",
                "lng": home[0] + dx,
                "lat": home[1] + dy,
                "title": li["title"],
                "subtitle": f"${int(li['current_price'])} · pickup only",
                "slug": li["public_slug"],
            }
        )
    seen = set()
    async for m in db.matches.find({"move_id": move["_id"]}).sort("score", -1):
        if m["need_id"] in seen:
            continue
        seen.add(m["need_id"])
        need = await db.needs.find_one({"_id": m["need_id"]})
        item = await db.items.find_one({"_id": m["item_id"]})
        if not need or not item or not _pt(need.get("location")):
            continue
        lng, lat = _pt(need["location"])
        status = {"accepted": "pickup set", "offered": "offer sent"}.get(m["status"], f"{int(m['score'] * 100)}% match")
        out.append(
            {
                "id": f"arrival-{need['_id']}",
                "kind": "arrival",
                "lng": lng,
                "lat": lat,
                "title": f"{need['arrival_name']} — {need['item_wanted']}",
                "subtitle": f"{item['name']} · {status}",
            }
        )
    for i, site in enumerate(DONATION_SITES):
        out.append(
            {
                "id": f"donate-{i}",
                "kind": "donation",
                "lng": site["coordinates"][0],
                "lat": site["coordinates"][1],
                "title": site["name"],
                "subtitle": f"{site['city']} · {site['accepts']}",
            }
        )
    async for v in db.vendors.find({}):
        if _pt(v.get("location")):
            lng, lat = _pt(v["location"])
            out.append(
                {
                    "id": f"vendor-{v['_id']}",
                    "kind": "vendor",
                    "lng": lng,
                    "lat": lat,
                    "title": v["name"],
                    "subtitle": f"{v['type'].replace('_', ' ')} · ★{v.get('rating')}",
                }
            )
    return out
