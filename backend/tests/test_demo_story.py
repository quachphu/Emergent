"""The demo story from the spec, end to end through the API."""

import asyncio
from pathlib import Path

SAMPLES = Path(__file__).resolve().parents[2] / "frontend" / "public" / "samples"


async def _wait(fn, tries=300):
    for _ in range(tries):
        out = await fn()
        if out:
            return out
        await asyncio.sleep(0.03)
    raise AssertionError("timed out")


async def test_demo_story(demo):
    c = demo["client"]
    s = (await c.get("/api/moves/current/summary")).json()
    assert s["days_left"] == 12 and s["move"]["from_city"] == "Long Beach" and s["move"]["to_city"] == "San Francisco"
    assert s["distance_miles"] > 300 and s["commute_minutes"]

    # She snaps a chair and a table.
    files = [("files", (n, (SAMPLES / n).read_bytes(), "image/jpeg")) for n in ["dining-chair.jpg", "dining-table.jpg"]]
    media = (await c.post("/api/scan/upload", files=files, data={"auto_analyze": "false"})).json()
    items = (await c.post("/api/scan/analyze", json={"media_ids": [m["id"] for m in media]})).json()
    for it in items:
        await c.post(f"/api/items/{it['id']}/decide", json={"direction": "accept"})

    # The plan appears; she approves it.
    run = (await c.post("/api/runs/propose")).json()
    titles = " | ".join(a["title"].lower() for a in run["actions"])
    assert "list the writing desk" in titles and "offer the office chair" in titles and "city pickup" in titles and "haul quotes" in titles
    await c.post(f"/api/runs/{run['id']}/approve")
    await _wait(lambda: _run_done(c))

    # Each outbound step waits; she approves them.
    waiting = (await c.get("/api/steps", params={"state": "waiting_for_user"})).json()
    for st in waiting:
        if st.get("gate") and st["gate"]["handler"] != "pay_quote":
            await c.post(f"/api/steps/{st['id']}/approve")

    # Three hauler quotes arrive; she books the cheapest with Stripe (test checkout).
    jobs = await _wait(lambda: _haul_quotes(c))
    q = min(jobs, key=lambda x: x["price"])
    pay = (await c.post(f"/api/quotes/{q['id']}/book")).json()
    pay = (await c.post(f"/api/steps/{pay['id']}/approve")).json()
    booking_id = pay["receipt"]["meta"]["booking_id"]
    assert (await c.post(f"/api/bookings/{booking_id}/simulate-pay")).json()["status"] == "paid"
    paid = (await c.get("/api/steps")).json()
    assert any((st.get("receipt") or {}).get("meta", {}).get("paid") for st in paid)

    # Notice letter and lease summary are ready.
    old = (await c.get("/api/old-home")).json()
    assert old["letter"] and "______" in old["letter"]["extracted_text"]
    new = (await c.get("/api/new-home")).json()
    lease = new["leases"][0]
    assert lease["summary"] and len(lease["flags"]) >= 4
    sign = next(st for st in (await c.get("/api/steps", params={"state": "waiting_for_user"})).json() if st["title"].startswith("Sign and send"))
    await c.post(f"/api/steps/{sign['id']}/complete")

    # The chair matches an incoming new grad.
    await _wait(lambda: _chair_handed(c))

    s = (await c.get("/api/moves/current/summary")).json()
    items = {i["name"]: i for i in (await c.get("/api/items")).json()}
    assert items["Office chair"]["status"] == "handoff_scheduled"
    assert s["resolved_pct"] >= 0.70, s["resolved_pct"]
    assert s["money"]["earned"] > 0 and s["money"]["spent"] == q["price"]
    assert s["impact"]["items_rehomed"] >= 3


async def _run_done(c):
    r = (await c.get("/api/runs/current")).json()
    return r["status"] == "done"


async def _haul_quotes(c):
    jobs = (await c.get("/api/jobs")).json()
    qs = [q for j in jobs if j["type"] == "haul" for q in j["quotes"] if q["status"] == "open"]
    return qs if len(qs) >= 3 else None


async def _chair_handed(c):
    items = {i["name"]: i for i in (await c.get("/api/items")).json()}
    return all(i["status"] in {"handoff_scheduled", "handed_off"} for i in items.values() if i["decision"] == "HANDOFF" and i["status"] == "offered") or None
