from datetime import date
from pathlib import Path

PHOTO = Path(__file__).resolve().parents[1] / "data" / "demo_photos" / "couch.jpg"


async def test_sample_lease_summary_is_useful(demo):
    c = demo["client"]
    doc = (await c.post("/api/documents/sample-lease")).json()
    assert "Security Deposit" in doc["extracted_text"]
    out = (await c.post(f"/api/documents/{doc['id']}/summarize")).json()
    s = out["summary"]
    assert s["rent"] == "$3,150.00" and s["deposit"] == "$4,725.00" and s["term"] == "12 months" and s["notice_period"] == "60 days"
    cats = {f["category"] for f in out["flags"]}
    assert {"fees", "renewal", "deposit", "unusual"} <= cats
    assert any("non-refundable" in f["clause"].lower() and f["severity"] == "high" for f in out["flags"])
    assert any("waive" in f["clause"].lower() for f in out["flags"])
    assert len(s["questions"]) >= 3
    new = (await c.get("/api/new-home")).json()
    assert new["legal_note"] == "For your review, not legal advice."
    assert new["utilities"] and new["application"]


async def test_admin_checklist_is_dated(demo):
    c = demo["client"]
    items = (await c.get("/api/admin/checklist")).json()["items"]
    keys = [i["key"] for i in items]
    assert keys[:2] == ["usps_forwarding", "employer_address"] and "dmv_address" in keys and "voter_registration" in keys
    move = (await c.get("/api/moves/current")).json()
    md = date.fromisoformat(move["move_date"])
    dues = {i["key"]: date.fromisoformat(i["due"]) for i in items}
    assert (md - dues["usps_forwarding"]).days == 14
    assert (dues["dmv_address"] - md).days == 10
    usps = next(i for i in items if i["key"] == "usps_forwarding")
    assert usps["link"].startswith("https://moversguide.usps.com")
    assert all(i["task_id"] for i in items)
    assert next(i for i in items if i["key"] == "employer_address")["draft"]["body"]


async def test_notice_letter_and_moveout_photos(demo):
    c = demo["client"]
    doc = (await c.post("/api/old-home/notice", json={"landlord_name": "Ocean Breeze PM"})).json()
    assert "Ocean Breeze PM" in doc["extracted_text"] and "______" in doc["extracted_text"] and "21 days" in doc["extracted_text"]
    old = (await c.get("/api/old-home")).json()
    assert old["notice"]["late"] is True  # 30-day notice, 12 days left
    assert old["deposit"]["days"] == 21
    room = old["rooms"][0]
    r = await c.post("/api/old-home/photos", files={"file": ("living.jpg", PHOTO.read_bytes(), "image/jpeg")}, data={"room_id": room["id"]})
    assert r.status_code == 200 and r.json()["taken_at"]


async def test_car_estimate_and_ship_path(demo):
    c = demo["client"]
    r = await c.post("/api/car/analyze", data={"hint": "2018 Toyota Corolla 52,000 miles"})
    car = r.json()["car"]
    assert (car["make"], car["model"], car["year"], car["mileage"]) == ("Toyota", "Corolla", 2018, 52000)
    assert 0 < car["value_low"] < car["value_high"]
    car = (await c.patch("/api/car", json={"path": "ship", "mileage": 90000})).json()["car"]
    assert car["path"] == "ship"
    job = (await c.post("/api/jobs", json={"type": "auto_transport"})).json()
    assert job["type"] == "auto_transport" and job["package"]["car"]["model"] == "Corolla"
