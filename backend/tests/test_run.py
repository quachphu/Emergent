import asyncio


async def _wait(fn, tries=200):
    for _ in range(tries):
        out = await fn()
        if out:
            return out
        await asyncio.sleep(0.03)
    raise AssertionError("timed out")


async def test_plan_preview_edit_approve_and_live_steps(demo):
    c = demo["client"]
    run = (await c.post("/api/runs/propose")).json()
    kinds = [a["kind"] for a in run["actions"]]
    for k in ["list_item", "offer_item", "city_pickup", "haul_quotes", "notice_letter", "lease_summary"]:
        assert k in kinds, kinds
    desk = next(a for a in run["actions"] if a["kind"] == "list_item")
    assert "desk" in desk["title"].lower()
    donate = next(a for a in run["actions"] if a["kind"] == "donate")
    run = (await c.patch(f"/api/runs/{run['id']}/actions/{donate['id']}", json={"enabled": False})).json()
    run = (await c.patch(f"/api/runs/{run['id']}/actions/{desk['id']}", json={"params": {"start_price": 110}, "title": "List the desk at $110"})).json()
    assert next(a for a in run["actions"] if a["id"] == desk["id"])["title"] == "List the desk at $110"

    r = await c.post(f"/api/runs/{run['id']}/approve")
    assert r.status_code == 200
    assert (await c.post(f"/api/runs/{run['id']}/approve")).status_code == 409

    async def finished():
        rr = (await c.get("/api/runs/current")).json()
        return rr if rr["status"] == "done" else None

    rr = await _wait(finished)
    assert all(a["status"] in {"done", "planned"} for a in rr["actions"])
    assert next(a for a in rr["actions"] if a["kind"] == "donate")["status"] == "planned"  # removed by the user

    steps = (await c.get("/api/steps", params={"run_id": run["id"]})).json()
    done = [s for s in steps if s["state"] == "done"]
    assert len(done) >= 6 and all(s.get("receipt") for s in done)
    waiting = [s for s in steps if s["state"] == "waiting_for_user"]
    handlers = {s["gate"]["handler"] for s in waiting if s.get("gate")}
    assert {"activate_listing", "send_handoff_offer", "book_city_pickup", "send_job_sms"} <= handlers
    assert any("$110" in (s["gate"] or {}).get("preview", "") for s in waiting if s.get("gate"))
    offer = next(s for s in waiting if s.get("gate") and s["gate"]["handler"] == "send_handoff_offer")
    assert "AI assistant" in offer["gate"]["preview"]
    assert any(s["title"].startswith("Sign and send") for s in waiting)  # routed to the user's signature

    # Approve each outbound step; offers get accepted and quotes arrive (DEMO_MODE).
    for s in waiting:
        if s.get("gate"):
            out = (await c.post(f"/api/steps/{s['id']}/approve")).json()
            assert out["state"] in {"done", "running"}

    async def quotes():
        jobs = (await c.get("/api/jobs")).json()
        return [q for j in jobs for q in j["quotes"] if q["status"] == "open"] if jobs else None

    assert len(await _wait(quotes)) == 3
    items = {i["name"]: i for i in (await c.get("/api/items")).json()}
    assert items["Writing desk"]["status"] == "listed"
    assert items["Queen mattress"]["status"] == "pickup_booked"

    async def handed():
        it = {i["name"]: i for i in (await c.get("/api/items")).json()}
        return it["Office chair"]["status"] == "handoff_scheduled" or None

    await _wait(handed)
    summary = (await c.get("/api/moves/current/summary")).json()
    assert summary["resolved_pct"] > 0.45


async def test_pause_takeover_undo(demo):
    c = demo["client"]
    run = (await c.post("/api/runs/propose")).json()
    await c.post(f"/api/runs/{run['id']}/approve")
    assert (await c.post(f"/api/runs/{run['id']}/pause")).json()["status"] in {"paused", "done"}
    await c.post(f"/api/runs/{run['id']}/resume")

    async def waiting():
        st = (await c.get("/api/steps", params={"state": "waiting_for_user"})).json()
        return [s for s in st if s.get("gate") and s["gate"]["handler"] == "activate_listing"] or None

    listing_step = (await _wait(waiting))[0]
    done = (await c.post(f"/api/steps/{listing_step['id']}/approve")).json()
    assert done["undo"]
    undone = (await c.post(f"/api/steps/{listing_step['id']}/undo")).json()
    assert undone["undone"] is True
    items = {i["name"]: i for i in (await c.get("/api/items")).json()}
    assert items["Writing desk"]["status"] == "decided"

    async def pickup():
        st = (await c.get("/api/steps", params={"state": "waiting_for_user"})).json()
        return [s for s in st if s.get("gate") and s["gate"]["handler"] == "book_city_pickup"] or None

    p = (await _wait(pickup))[0]
    out = (await c.post(f"/api/steps/{p['id']}/takeover")).json()
    assert out["state"] == "done" and out["taken_over"] is True
