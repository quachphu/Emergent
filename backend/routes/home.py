from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from agents import car as car_agent
from agents import paperwork
from agents.home import draft_notice, extract_pdf_text, summarize_document
from agents.orchestrator import replan
from agents.schedule import deposit_due, parse_date
from ai.llm import Image
from core.db import get_db, insert, now, to_json
from core.deps import current_move, current_user
from core.files import file_b64, file_url, store_file, store_image
from data.sample_lease import sample_lease_pdf

router = APIRouter(tags=["home"])

SENSITIVE_NOTICE = "Never upload or type SSNs, government ID numbers, bank account numbers or passwords. Handoff doesn't need them."


# ---------------- documents / vault ----------------


@router.get("/documents")
async def documents(move: dict = Depends(current_move)):
    docs = [d async for d in get_db().documents.find({"move_id": move["_id"]}).sort("created_at", -1)]
    today = date.today()
    for d in docs:
        if d.get("expires_at"):
            d["days_to_expiry"] = (parse_date(d["expires_at"]) - today).days
    return {"documents": to_json(docs), "notice": SENSITIVE_NOTICE, "reminders": _reminders(move)}


def _reminders(move: dict) -> list[dict]:
    md = parse_date(move["move_date"])
    return [
        {"title": "Security deposit due back", "date": deposit_due(md).isoformat(), "note": "California: 21 days after move-out."},
        {"title": "Renters insurance must start", "date": md.isoformat(), "note": "Upload the policy to your Vault."},
        {"title": "DMV address change deadline", "date": (md + timedelta(days=10)).isoformat(), "note": "Within 10 days of moving."},
    ]


@router.post("/documents")
async def upload_document(
    file: UploadFile = File(...), type: str = Form("lease"), title: str = Form(""), expires_at: str = Form(""), move: dict = Depends(current_move)
):
    if type not in {"lease", "contract", "photo", "receipt", "letter", "other"}:
        raise HTTPException(422, "Unknown document type.")
    raw = await file.read()
    ctype = file.content_type or "application/octet-stream"
    text = ""
    if ctype == "application/pdf" or (file.filename or "").lower().endswith(".pdf"):
        stored = await store_file(raw, "application/pdf", move_id=move["_id"], name=file.filename or "document.pdf", kind="document")
        text = extract_pdf_text(raw)
    elif ctype.startswith("image/"):
        stored = await store_image(raw, move_id=move["_id"], name=file.filename or "photo", kind="document")
    elif ctype.startswith("text/"):
        stored = await store_file(raw, ctype, move_id=move["_id"], name=file.filename or "document.txt", kind="document")
        text = raw.decode("utf-8", "ignore")
    else:
        raise HTTPException(422, "Upload a PDF, image or text file.")
    doc = await insert(
        "documents",
        {
            "move_id": move["_id"],
            "type": type,
            "title": title or file.filename or type.title(),
            "file": file_url(stored["_id"]),
            "extracted_text": text,
            "summary": None,
            "flags": [],
            "expires_at": expires_at or None,
        },
    )
    return to_json(doc)


@router.post("/documents/sample-lease")
async def sample_lease(move: dict = Depends(current_move), user: dict = Depends(current_user)):
    data = sample_lease_pdf(user["name"], move.get("to_address") or "San Francisco, CA", move["move_date"])
    stored = await store_file(data, "application/pdf", move_id=move["_id"], name="sample-lease.pdf", kind="document")
    doc = await insert(
        "documents",
        {
            "move_id": move["_id"],
            "type": "lease",
            "title": "New apartment lease (sample)",
            "file": file_url(stored["_id"]),
            "extracted_text": extract_pdf_text(data),
            "summary": None,
            "flags": [],
            "expires_at": None,
        },
    )
    return to_json(doc)


@router.post("/documents/{doc_id}/summarize")
async def summarize(doc_id: str, move: dict = Depends(current_move)):
    try:
        return to_json(await summarize_document(move, doc_id))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, move: dict = Depends(current_move)):
    await get_db().documents.delete_one({"_id": doc_id, "move_id": move["_id"]})
    return {"ok": True}


# ---------------- old home ----------------


@router.get("/old-home")
async def old_home(move: dict = Depends(current_move), user: dict = Depends(current_user)):
    db = get_db()
    letter = await db.documents.find_one({"move_id": move["_id"], "type": "letter", "kind": "notice"})
    rooms = [r async for r in db.rooms.find({"move_id": move["_id"]})]
    photos = [p async for p in db.documents.find({"move_id": move["_id"], "type": "photo", "kind": "moveout"}).sort("created_at", 1)]
    md = parse_date(move["move_date"])
    due = deposit_due(md)
    return to_json(
        {
            "notice": paperwork.notice_status(move),
            "letter": letter,
            "rooms": rooms,
            "photos": photos,
            "deposit": {
                "move_out": md.isoformat(),
                "due": due.isoformat(),
                "days_until_due": (due - date.today()).days,
                "days": 21,
                "letter": paperwork.deposit_letter(user, move).model_dump(),
            },
            "landlord_name": move.get("landlord_name"),
            "notice_sent": bool(move.get("notice_sent")),
        }
    )


class NoticeIn(BaseModel):
    landlord_name: str | None = None
    notice_period_days: int | None = None


@router.post("/old-home/notice")
async def notice(body: NoticeIn, move: dict = Depends(current_move), user: dict = Depends(current_user)):
    db = get_db()
    data = body.model_dump(exclude_none=True)
    if data:
        await db.moves.update_one({"_id": move["_id"]}, {"$set": data})
        move = await db.moves.find_one({"_id": move["_id"]})
    return to_json(await draft_notice(move, user))


@router.post("/old-home/photos")
async def moveout_photo(file: UploadFile = File(...), room_id: str = Form(...), move: dict = Depends(current_move)):
    raw = await file.read()
    try:
        stored = await store_image(raw, move_id=move["_id"], name=file.filename or "moveout.jpg", kind="moveout")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    room = await get_db().rooms.find_one({"_id": room_id})
    doc = await insert(
        "documents",
        {
            "move_id": move["_id"],
            "type": "photo",
            "kind": "moveout",
            "room_id": room_id,
            "title": f"Move-out: {room['name'] if room else 'room'}",
            "file": file_url(stored["_id"]),
            "taken_at": now(),
            "flags": [],
        },
    )
    rooms_total = await get_db().rooms.count_documents({"move_id": move["_id"]})
    rooms_done = len(await get_db().documents.distinct("room_id", {"move_id": move["_id"], "type": "photo", "kind": "moveout"}))
    if rooms_total and rooms_done >= rooms_total:
        await get_db().tasks.update_one({"move_id": move["_id"], "key": "moveout_photos"}, {"$set": {"status": "done"}})
    return to_json(doc)


# ---------------- new home ----------------


@router.get("/new-home")
async def new_home(move: dict = Depends(current_move)):
    db = get_db()
    leases = [d async for d in db.documents.find({"move_id": move["_id"], "type": "lease"}).sort("created_at", -1)]
    checks = move.get("application_checks") or {}
    return to_json(
        {
            "leases": leases,
            "legal_note": paperwork.LEGAL_NOTE,
            "sensitive_notice": SENSITIVE_NOTICE,
            "application": [{**a, "done": bool(checks.get(a["key"]))} for a in paperwork.APPLICATION_PACKET],
            "utilities": paperwork.utilities_plan(move),
        }
    )


class CheckIn(BaseModel):
    key: str
    done: bool


@router.post("/new-home/application")
async def application_check(body: CheckIn, move: dict = Depends(current_move)):
    db = get_db()
    await db.moves.update_one({"_id": move["_id"]}, {"$set": {f"application_checks.{body.key}": body.done}})
    move = await db.moves.find_one({"_id": move["_id"]})
    checks = move.get("application_checks") or {}
    if all(checks.get(a["key"]) for a in paperwork.APPLICATION_PACKET):
        await db.tasks.update_one({"move_id": move["_id"], "key": "application_packet"}, {"$set": {"status": "done"}})
    return {"ok": True}


# ---------------- admin ----------------


@router.get("/admin/checklist")
async def admin(move: dict = Depends(current_move), user: dict = Depends(current_user)):
    db = get_db()
    tasks = {t["key"]: t async for t in db.tasks.find({"move_id": move["_id"], "lane": "admin"})}
    items = paperwork.admin_checklist(user, move)
    for it in items:
        t = tasks.get(it["key"])
        it["task_id"] = t["_id"] if t else None
        it["status"] = t["status"] if t else "todo"
    return {"items": items, "notice": "You do every login yourself. Handoff drafts the emails and links the official sites."}


# ---------------- car ----------------


@router.post("/car/analyze")
async def car_analyze(files: list[UploadFile] = File(default=[]), hint: str = Form(""), move: dict = Depends(current_move)):
    images = []
    for f in files[:4]:
        stored = await store_image(await f.read(), move_id=move["_id"], name=f.filename or "car.jpg", kind="car")
        b64 = await file_b64(stored["_id"])
        if b64:
            images.append(Image(data_b64=b64[0], media_type=b64[1], name=f.filename or ""))
    est, source = await car_agent.estimate(images, hint)
    car = {**est.model_dump(), "source": source, "path": (move.get("car") or {}).get("path")}
    await get_db().moves.update_one({"_id": move["_id"]}, {"$set": {"car": car}})
    await replan(await get_db().moves.find_one({"_id": move["_id"]}))
    return {
        "car": car,
        "label": "Value is an estimate based on similar cars.",
        "sell_checklist": car_agent.SELL_CHECKLIST,
        "ship_checklist": car_agent.SHIP_CHECKLIST,
    }


class CarPatch(BaseModel):
    make: str | None = None
    model: str | None = None
    year: int | None = None
    mileage: int | None = None
    path: str | None = None  # sell | ship


@router.get("/car")
async def get_car(move: dict = Depends(current_move)):
    car = move.get("car")
    listing = None
    if car:
        listing = {
            "title": f"{car['year']} {car['make']} {car['model']} — {car.get('mileage') or '?'} miles",
            "body": f"{car['year']} {car['make']} {car['model']}, {car.get('mileage') or 'unknown'} miles. Clean title in my name. Moving out of state soon — "
            "serious buyers only, meet in a public place. Smog certificate provided.",
        }
    return {
        "car": car,
        "label": "Value is an estimate based on similar cars.",
        "sell_checklist": car_agent.SELL_CHECKLIST,
        "ship_checklist": car_agent.SHIP_CHECKLIST,
        "listing_draft": listing,
    }


@router.patch("/car")
async def patch_car(body: CarPatch, move: dict = Depends(current_move)):
    car = move.get("car") or car_agent.fallback_estimate().model_dump()
    data = body.model_dump(exclude_none=True)
    car.update(data)
    if {"make", "year", "mileage"} & set(data):
        lo, hi = car_agent.value_range(car["make"], int(car["year"]), car.get("mileage"))
        car["value_low"], car["value_high"] = lo, hi
    await get_db().moves.update_one({"_id": move["_id"]}, {"$set": {"car": car}})
    if data.get("path"):
        await get_db().tasks.update_one({"move_id": move["_id"], "key": "car_decision"}, {"$set": {"status": "in_progress", "notes": f"Path: {data['path']}"}})
    return {"car": car}
