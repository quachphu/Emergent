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
