import asyncio
from pathlib import Path

SAMPLES = Path(__file__).resolve().parents[2] / "frontend" / "public" / "samples"


async def test_chair_and_table_photos_become_item_cards(demo):
    c = demo["client"]
    files = [("files", (n, (SAMPLES / n).read_bytes(), "image/jpeg")) for n in ["dining-chair.jpg", "dining-table.jpg"]]
    r = await c.post("/api/scan/upload", files=files, data={"auto_analyze": "false"})
    assert r.status_code == 200, r.text
    media = r.json()
    assert len(media) == 2
    r = await c.post("/api/scan/analyze", json={"media_ids": [m["id"] for m in media]})
    assert r.status_code == 200, r.text
    items = {i["name"]: i for i in r.json()}
    assert set(items) == {"Dining chair", "Dining table"}
    for it in items.values():
        assert 0 < it["resale_low"] < it["resale_high"]
        assert it["photos"] and it["size"] in {"S", "M", "L", "XL"} and 1 <= it["condition"] <= 5
        assert it["suggestion"]["decision"] and it["suggestion"]["reason"]
    # A new grad needs "kitchen table and two chairs" in Long Beach → hand off instead of donating.
    assert items["Dining chair"]["suggestion"]["decision"] == "HANDOFF"
    steps = (await c.get("/api/steps", params={"lane": "stuff"})).json()
    assert any("Found 2 items" in (s.get("receipt") or {}).get("text", "") for s in steps)


async def test_edit_delete_and_decide(demo):
    c = demo["client"]
    files = [("files", ("dining-table.jpg", (SAMPLES / "dining-table.jpg").read_bytes(), "image/jpeg"))]
    media = (await c.post("/api/scan/upload", files=files, data={"auto_analyze": "false"})).json()
    item = (await c.post("/api/scan/analyze", json={"media_ids": [media[0]["id"]]})).json()[0]
    r = await c.patch(f"/api/items/{item['id']}", json={"name": "Oak dining table", "condition": 5})
    assert r.json()["name"] == "Oak dining table" and r.json()["condition"] == 5
    r = await c.post(f"/api/items/{item['id']}/decide", json={"direction": "keep"})
    assert r.json()["decision"] == "KEEP"
    r = await c.post(f"/api/items/{item['id']}/decide", json={"direction": "let_go"})
    assert r.json()["decision"] != "KEEP"
    assert (await c.delete(f"/api/items/{item['id']}")).status_code == 200
    assert (await c.get(f"/api/items/{item['id']}")).status_code == 404


async def test_phone_capture_link_and_upload(demo):
    c = demo["client"]
    tok = (await c.post("/api/scan/capture-link", json={})).json()["token"]
    info = (await c.get(f"/api/public/capture/{tok}")).json()
    assert info["first_name"] == "Maya"
    files = [("files", ("dining-chair.jpg", (SAMPLES / "dining-chair.jpg").read_bytes(), "image/jpeg"))]
    del c.headers["Authorization"]
    r = await c.post(f"/api/public/capture/{tok}", files=files)
    assert r.status_code == 200 and r.json()["received"] == 1
    assert (await c.get("/api/public/capture/not-a-token")).status_code == 404
    c.headers["Authorization"] = f"Bearer {demo['token']}"
    for _ in range(40):
        names = [i["name"] for i in (await c.get("/api/items")).json()]
        if "Dining chair" in names:
            break
        await asyncio.sleep(0.05)
    assert "Dining chair" in names


async def test_rejects_non_images(demo):
    c = demo["client"]
    r = await c.post("/api/scan/upload", files=[("files", ("x.txt", b"hello", "text/plain"))], data={"auto_analyze": "false"})
    assert r.status_code == 422


async def test_need_small_desk_matches_scanned_desk(client):
    # Fresh user in Long Beach scans a desk; an arrival posts "small desk for a studio".
    r = await client.post("/api/auth/signup", json={"name": "Sam Lee", "email": "sam@example.com", "password": "password123"})
    client.headers["Authorization"] = f"Bearer {r.json()['token']}"
    await client.post(
        "/api/moves", json={"move_date": "2030-06-01", "from_address": "Alamitos Beach, Long Beach, CA", "to_address": "Mission District, San Francisco, CA"}
    )
    photo = (SAMPLES.parents[1] / ".." / "backend" / "data" / "demo_photos" / "desk.jpg").resolve().read_bytes()
    media = (await client.post("/api/scan/upload", files=[("files", ("desk.jpg", photo, "image/jpeg"))], data={"auto_analyze": "false"})).json()
    desk = (await client.post("/api/scan/analyze", json={"media_ids": [media[0]["id"]]})).json()[0]
    assert desk["name"] == "Desk"
    await client.post(
        "/api/public/needs",
        json={"arrival_name": "Daniel R.", "city": "Long Beach", "item_wanted": "small desk for a studio", "details": "Compact desk for my laptop."},
    )
    await client.post("/api/public/needs", json={"arrival_name": "Ana M.", "city": "Long Beach", "item_wanted": "microwave"})
    matches = (await client.get("/api/matches")).json()
    pairs = {(m["item"]["name"], m["need"]["item_wanted"]) for m in matches}
    assert ("Desk", "small desk for a studio") in pairs
    assert ("Desk", "microwave") not in pairs
    assert all("contact" not in m["need"] for m in matches)  # arrivals' contacts never leak


async def test_public_listing_and_interest(demo):
    c = demo["client"]
    listings = (await c.get("/api/listings")).json()
    side = next(li for li in listings if li["status"] == "active")
    del c.headers["Authorization"]
    page = (await c.get(f"/api/public/listings/{side['public_slug']}")).json()
    assert page["price"] > 0 and page["photos"] and page["pickup_windows"] and "in person" in page["payment_note"]
    r = await c.post(
        f"/api/public/listings/{side['public_slug']}/interest", json={"name": "Jo", "contact": "jo@example.com", "proposed_time": page["pickup_windows"][0]}
    )
    assert r.status_code == 200
    c.headers["Authorization"] = f"Bearer {demo['token']}"
    inbox = (await c.get("/api/inbox")).json()
    req = next(r for r in inbox["requests"] if r["name"] == "Jo")
    step = (await c.post(f"/api/listings/{req['listing_id']}/interest/{req['id']}/accept")).json()
    assert step["state"] == "waiting_for_user" and "AI assistant" in step["gate"]["preview"]
    sold = (await c.post(f"/api/listings/{side['id']}/sold", json={"price": 30})).json()
    assert sold["status"] == "sold"
