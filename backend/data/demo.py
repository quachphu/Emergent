"""Demo seed: Maya, a new grad moving from Long Beach to San Francisco in 12 days."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from agents import steps
from agents.matchmaker import ensure_item_embedding, ensure_need_embedding, run_matching
from agents.orchestrator import replan
from core.db import get_db, insert, now
from core.files import file_url, store_file
from core.security import hash_password
from data.catalog import CATALOG
from data.city_rules import CITY_RULES
from data.sample_lease import sample_lease_pdf
from services.geo import area_label, gazetteer_lookup

DEMO_EMAIL = "maya@handoff.demo"
DEMO_PASSWORD = "handoff-demo"
PHOTOS = Path(__file__).parent / "demo_photos"

FROM = "245 Corona Ave, Apt 3, Belmont Shore, Long Beach, CA 90803"
TO = "1180 Valencia St, Apt 4B, Mission District, San Francisco, CA 94110"
WORK = "500 Market St, Financial District, San Francisco, CA 94105"

# (catalog key, room, decision, reason, overrides)
ITEMS = [
    (
        "desk",
        "Office",
        "SELL",
        "Sells for $60–$140 with 12 days left; worth more than shipping it.",
        {"name": "Writing desk", "brand_guess": "IKEA", "condition": 4, "dims_estimate": '43" W x 22" D x 30" H', "resale_low": 60, "resale_high": 120},
    ),
    (
        "office_chair",
        "Office",
        "HANDOFF",
        "An arrival needs a desk chair — a free handoff keeps it out of the landfill.",
        {"brand_guess": "IKEA Markus", "condition": 4},
    ),
    ("bookshelf", "Living room", "HAUL", "Too big to donate by car; bundle it into one haul-away job.", {"condition": 3}),
    ("mattress", "Bedroom", "CITY_PICKUP", "Mattresses can't be resold or donated easily; the city picks them up free.", {"condition": 3}),
    ("bed_frame", "Bedroom", "HAUL", "Bulky and cheap to replace in SF; haul it with the couch.", {"condition": 3}),
    ("tv", "Living room", "SELL", "Electronics sell fast; shipping a TV risks the screen.", {"brand_guess": "TCL", "condition": 4}),
    ("monitor", "Office", "KEEP", "Costs ~$260 to replace and only ~$25 to ship.", {"brand_guess": "Dell", "condition": 5}),
    ("lamp", "Living room", "DONATE", "Small and still useful — a quick donation drop-off.", {"condition": 4}),
    ("microwave", "Kitchen", "HANDOFF", "Someone arriving in town needs one — it stays out of the landfill.", {"brand_guess": "Panasonic", "condition": 4}),
    ("couch", "Living room", "HAUL", "Won't fit a car and the new place is furnished; haul it.", {"condition": 2}),
    ("side_table", "Bedroom", "SELL", "Quick sale at $15–$40.", {"condition": 4}),
    ("rug", "Living room", "DONATE", "Easy donation; rugs rarely sell.", {"condition": 3}),
    ("plant", "Living room", "HANDOFF", "Plants don't survive shipping; an arrival wants greenery.", {"name": "Monstera plant", "condition": 5}),
    ("books", "Office", "KEEP", "Cheap to ship by media mail and hard to replace.", {"condition": 4}),
]

NEEDS = [
    ("Priya S.", "Long Beach", "Belmont Shore", "office chair", "New grad starting remote work, need a comfortable desk chair.", 9),
    ("Daniel R.", "Long Beach", "Alamitos Beach", "small desk for a studio", "Just moved into a studio, need a compact desk for my laptop.", 10),
    ("Ana M.", "Long Beach", "Downtown Long Beach", "microwave", "Moving in next week, kitchen is empty!", 8),
    ("Jordan K.", "Long Beach", "Belmont Heights", "house plants", "Want some greenery for my first apartment.", 14),
    ("Mei W.", "Long Beach", "Bixby Knolls", "kitchen table and two chairs", "Small dining set for two.", 15),
    ("Tara B.", "Long Beach", "Alamitos Beach", "dresser", "Any dresser with drawers.", 12),
    ("Omar H.", "Long Beach", "Downtown Long Beach", "commuter bike", "Need a bike to get to campus.", 20),
    ("Kenji T.", "San Francisco", "SoMa", "couch for a one-bedroom", "Arriving from Seattle for a job.", 18),
    ("Rosa P.", "San Francisco", "Mission District", "bookshelf", "Grad student, lots of books.", 16),
    ("Ethan L.", "San Francisco", "Noe Valley", "desk lamp", "Need light for a home office.", 13),
]

VENDORS = [
    ("Shoreline Haul & Donate", "hauler", "+15625550141", 4.8, ["Long Beach", "Los Angeles County"], 0.95, 0, (-118.17, 33.78)),
    ("Junk Bros LB", "hauler", "+15625550142", 4.6, ["Long Beach", "Lakewood"], 0.88, 1, (-118.19, 33.80)),
    ("GreenLoop Hauling", "hauler", "+15625550143", 4.9, ["Long Beach", "Orange County"], 1.15, 2, (-118.13, 33.77)),
    ("Golden State Movers", "mover", "+15625550144", 4.7, ["Long Beach", "San Francisco", "California"], 1.0, 0, (-118.20, 33.79)),
    ("Two Coast Moving Co.", "mover", "+15625550145", 4.5, ["Long Beach", "San Francisco", "California"], 0.9, 1, (-118.15, 33.81)),
    ("PacificCar Shipping", "auto_transport", "+15625550146", 4.6, ["Long Beach", "San Francisco", "California"], 1.0, 2, (-118.21, 33.76)),
]


async def wipe_demo() -> None:
    db = get_db()
    user = await db.users.find_one({"email": DEMO_EMAIL})
    if user:
        moves = [m["_id"] async for m in db.moves.find({"user_id": user["_id"]})]
        for coll in [
            "rooms",
            "items",
            "tasks",
            "listings",
            "matches",
            "jobs",
            "quotes",
            "bookings",
            "documents",
            "agent_steps",
            "scan_media",
            "files",
            "runs",
            "messages",
            "capture_tokens",
        ]:
            await db[coll].delete_many({"move_id": {"$in": moves}})
        await db.moves.delete_many({"user_id": user["_id"]})
        await db.users.delete_one({"_id": user["_id"]})
    await db.needs.delete_many({"demo": True})
    await db.vendors.delete_many({"demo": True})
    await db.city_rules.delete_many({})


async def seed(today: date | None = None) -> dict:
    """Restores the full demo. Returns the demo user."""
    today = today or date.today()
    db = get_db()
    await wipe_demo()
    for r in CITY_RULES:
        await insert("city_rules", dict(r))
    for name, vtype, phone, rating, area, factor, tmpl, (lng, lat) in VENDORS:
        await insert(
            "vendors",
            {
                "name": name,
                "type": vtype,
                "phone": phone,
                "email": None,
                "rating": rating,
                "service_area": area,
                "price_factor": factor,
                "template": tmpl,
                "location": {"type": "Point", "coordinates": [lng, lat]},
                "demo": True,
            },
        )
    for arrival, city, hood, wanted, details, by_days in NEEDS:
        geo = gazetteer_lookup(f"{hood}, {city}")
        need = await insert(
            "needs",
            {
                "arrival_name": arrival,
                "contact": "",
                "city": city,
                "neighborhood": hood,
                "item_wanted": wanted,
                "details": details,
                "needed_by": (today + timedelta(days=by_days)).isoformat(),
                "status": "open",
                "location": geo["geo"] if geo else None,
                "demo": True,
            },
        )
        await ensure_need_embedding(need)

    user = await insert("users", {"name": "Maya Chen", "email": DEMO_EMAIL, "password_hash": hash_password(DEMO_PASSWORD)})
    fg, tg, wg = gazetteer_lookup(FROM), gazetteer_lookup(TO), gazetteer_lookup(WORK)
    move = await insert(
        "moves",
        {
            "user_id": user["_id"],
            "move_date": (today + timedelta(days=12)).isoformat(),
            "from_address": FROM,
            "to_address": TO,
            "work_address": WORK,
            "from_geo": fg["geo"],
            "to_geo": tg["geo"],
            "work_geo": wg["geo"],
            "from_city": "Long Beach",
            "to_city": "San Francisco",
            "from_area": area_label(FROM, "Long Beach"),
            "to_area": area_label(TO, "San Francisco"),
            "home_size": "1br",
            "move_method": "shipping",
            "priorities": {"cash": 60, "speed": 55, "landfill": 80},
            "relocation_budget": 2500,
            "notice_period_days": 30,
            "landlord_name": "Ocean Breeze Property Management",
            "employer": "Lumen Labs",
            "floor": 2,
            "elevator": False,
            "onboarded": True,
            "demo": True,
            "inventory_confirmed_at": now(),
        },
    )
    rooms = {}
    for name in ["Living room", "Bedroom", "Kitchen", "Office"]:
        rooms[name] = (await insert("rooms", {"move_id": move["_id"], "name": name}))["_id"]

    created = {}
    for key, room, decision, reason, overrides in ITEMS:
        base = {k: v for k, v in CATALOG[key].items() if k not in {"key", "keywords"}}
        photo_path = PHOTOS / f"{key}.jpg"
        photos = []
        if photo_path.exists():
            f = await store_file(photo_path.read_bytes(), "image/jpeg", move_id=move["_id"], name=photo_path.name, kind="item_photo")
            photos = [file_url(f["_id"])]
        item = await insert(
            "items",
            {
                "move_id": move["_id"],
                "room_id": rooms[room],
                "photos": photos,
                **base,
                "condition": 3,
                "brand_guess": None,
                **overrides,
                "decision": decision,
                "decision_reason": reason,
                "suggestion": {"decision": decision, "reason": reason},
                "status": "decided",
                "location": move["from_geo"],
                "source": "demo",
                "confidence": 0.9,
            },
        )
        await ensure_item_embedding(item)
        created[key] = item

    # TV already sold; side table listed with a pickup request waiting.
    tv = created["tv"]
    await db.items.update_one({"_id": tv["_id"]}, {"$set": {"status": "sold", "sold_price": 160}})
    await insert(
        "listings",
        {
            "move_id": move["_id"],
            "item_id": tv["_id"],
            "title": 'TCL 43" TV — $160',
            "description": "Works great, remote included.",
            "price_schedule": [{"date": (today - timedelta(days=3)).isoformat(), "price": 180, "note": "List"}],
            "cutoff": (today + timedelta(days=7)).isoformat(),
            "current_price": 180,
            "public_slug": "tcl-43-tv-demo01",
            "status": "sold",
            "sold_price": 160,
            "interest_requests": [],
            "pickup_area": move["from_area"],
        },
    )
    st = created["side_table"]
    from agents.listing_pricing import create_listing

    li = await create_listing(move, st)
    await db.listings.update_one(
        {"_id": li["_id"]},
        {
            "$set": {
                "status": "active",
                "public_slug": "side-table-demo02",
                "interest_requests": [
                    {
                        "id": "req-demo-1",
                        "name": "Alex G.",
                        "contact": "alex@example.com",
                        "proposed_time": "Thursday after 6pm",
                        "message": "Is it still available?",
                        "status": "new",
                        "created_at": now(),
                    }
                ],
            }
        },
    )
    await db.items.update_one({"_id": st["_id"]}, {"$set": {"status": "listed"}})
    for key in ["monitor", "books"]:
        await db.items.update_one({"_id": created[key]["_id"]}, {"$set": {"status": "packed"}})

    # Sample lease, uploaded but not yet summarized.
    pdf = sample_lease_pdf("Maya Chen", TO, move["move_date"])
    f = await store_file(pdf, "application/pdf", move_id=move["_id"], name="valencia-lease.pdf", kind="document")
    from agents.home import extract_pdf_text

    await insert(
        "documents",
        {
            "move_id": move["_id"],
            "type": "lease",
            "title": "1180 Valencia St lease",
            "file": file_url(f["_id"]),
            "extracted_text": extract_pdf_text(pdf),
            "summary": None,
            "flags": [],
            "expires_at": (today + timedelta(days=12 + 365)).isoformat(),
        },
    )
    await insert(
        "documents",
        {
            "move_id": move["_id"],
            "type": "contract",
            "title": "Lumen Labs offer letter",
            "file": None,
            "extracted_text": "",
            "summary": "Start date and relocation stipend ($2,500).",
            "flags": [],
            "expires_at": None,
        },
    )

    move = await db.moves.find_one({"_id": move["_id"]})
    await replan(move, today)
    for key in ["application_packet", "usps_forwarding", "ship_boxes", "internet", "renters_insurance", "bank_address"]:
        await db.tasks.update_one({"move_id": move["_id"], "key": key}, {"$set": {"status": "done"}})
    await db.tasks.update_one({"move_id": move["_id"], "key": "employer_address"}, {"$set": {"status": "in_progress"}})
    await db.moves.update_one({"_id": move["_id"]}, {"$set": {"application_checks": {k: True for k in ["id", "offer_letter", "references", "credit", "fee"]}}})
    await run_matching(move)

    for title, rec, lane in [
        ("Built your plan: dated tasks across 5 lanes", steps.receipt("plan", f"Move day {move['move_date']}. Long Beach → San Francisco."), "stuff"),
        ("Look at 14 photos across 4 rooms", steps.receipt("inventory", "Found 14 items. Values are estimates based on similar items."), "stuff"),
        (
            "Sort 14 items: keep, sell, hand off, donate, pickup, haul",
            steps.receipt("note", "2 keep · 3 sell · 3 hand off · 2 donate · 1 city pickup · 3 haul"),
            "stuff",
        ),
        ("Marked the TV sold", steps.receipt("payment", "Sold for $160 — paid in person.", amount=160), "stuff"),
        ("Publish the side table listing", steps.receipt("listing", "Live at $35.", url="/l/side-table-demo02"), "stuff"),
    ]:
        await steps.create_step(move["_id"], lane, title, state="done", receipt=rec, agent="orchestrator")
    return user
