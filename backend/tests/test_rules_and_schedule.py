from datetime import date, timedelta

from agents.keep_or_let_go import decide, enforce_rules, rule_decision
from agents.schedule import current_price, list_date, notice_due, pickup_plan, price_schedule, task_due

TODAY = date(2026, 10, 25)

DESK = {
    "name": "Desk",
    "category": "Furniture",
    "size": "L",
    "condition": 4,
    "resale_low": 60,
    "resale_high": 140,
    "move_cost_estimate": 60,
    "replacement_cost_estimate": 280,
}
LAMP = {
    "name": "Floor lamp",
    "category": "Lighting",
    "size": "M",
    "condition": 4,
    "resale_low": 10,
    "resale_high": 35,
    "move_cost_estimate": 15,
    "replacement_cost_estimate": 70,
}
MATTRESS = {
    "name": "Queen mattress",
    "category": "Bedroom",
    "size": "XL",
    "condition": 3,
    "resale_low": 0,
    "resale_high": 60,
    "move_cost_estimate": 90,
    "replacement_cost_estimate": 650,
}
MONITOR = {
    "name": '27" monitor',
    "category": "Electronics",
    "size": "M",
    "condition": 5,
    "resale_low": 60,
    "resale_high": 130,
    "move_cost_estimate": 25,
    "replacement_cost_estimate": 260,
}


def test_no_sell_under_five_days():
    d, _ = rule_decision(DESK, 4, allow_keep=False)
    assert d != "SELL"
    d, _ = enforce_rules("SELL", "x", 4, has_match=False)
    assert d == "DONATE"
    d, _ = enforce_rules("SELL", "x", 3, has_match=True)
    assert d == "HANDOFF"
    d, _ = rule_decision(DESK, 12, allow_keep=False)
    assert d == "SELL"


def test_handoff_preferred_over_donate_when_match():
    d, _ = rule_decision(LAMP, 12, has_match=False, allow_keep=False)
    assert d == "DONATE"
    d, _ = rule_decision(LAMP, 12, has_match=True, allow_keep=False)
    assert d == "HANDOFF"
    d, _ = enforce_rules("DONATE", "x", 12, has_match=True)
    assert d == "HANDOFF"


def test_mattress_goes_to_city_pickup_and_monitor_is_kept():
    assert rule_decision(MATTRESS, 12)[0] == "CITY_PICKUP"
    assert rule_decision(MONITOR, 12, move_method="shipping")[0] == "KEEP"


async def test_decide_enforces_rules_even_with_model_fallback():
    d, reason, source = await decide(DESK, 3, has_match=False, allow_keep=False)
    assert d in {"DONATE", "HAUL"} and source == "fallback" and reason


def test_list_window_14_to_21_days():
    md = TODAY + timedelta(days=30)
    assert list_date(md, TODAY) == md - timedelta(days=21)
    md = TODAY + timedelta(days=12)
    assert list_date(md, TODAY) == TODAY


def test_price_drops_15pct_every_4_days_until_cutoff():
    md = TODAY + timedelta(days=21)
    sched = price_schedule(100, md, TODAY)
    prices = [p.price for p in sched.points]
    dates = [date.fromisoformat(p.date) for p in sched.points]
    assert prices[0] == 100 and prices[1] == 85 and prices[2] == 70  # 72.25 → rounded to $70
    assert all((b - a).days == 4 for a, b in zip(dates, dates[1:], strict=False))
    assert all(d < md - timedelta(days=5) for d in dates)
    assert sched.cutoff == (md - timedelta(days=5)).isoformat()
    assert current_price([p.__dict__ for p in sched.points], TODAY + timedelta(days=5)) == 85


def test_pickup_booking_lead_time():
    md = TODAY + timedelta(days=30)
    plan = pickup_plan(md, TODAY, 5)
    assert plan["tight"] is False
    assert date.fromisoformat(plan["pickup_date"]) - date.fromisoformat(plan["book_by"]) == timedelta(days=14)
    md = TODAY + timedelta(days=12)
    plan = pickup_plan(md, TODAY, 5)
    assert plan["tight"] is True and plan["book_by"] == TODAY.isoformat()
    assert date.fromisoformat(plan["pickup_date"]) >= TODAY + timedelta(days=5)
    assert date.fromisoformat(plan["pickup_date"]) < md


def test_due_dates_clamp_to_today_and_flag_tight():
    md = TODAY + timedelta(days=12)
    due = task_due(md, TODAY, 20)
    assert due.date == TODAY and due.tight
    due = task_due(md, TODAY, 7)
    assert due.date == md - timedelta(days=7) and not due.tight
    after = task_due(md, TODAY, -10)
    assert after.date == md + timedelta(days=10)
    assert notice_due(md, TODAY, 30).tight


async def test_replan_builds_all_five_lanes_and_is_idempotent():
    from agents.orchestrator import replan
    from core.db import get_db, insert

    user = await insert("users", {"name": "M", "email": "m@x.com"})
    move = await insert(
        "moves",
        {
            "user_id": user["_id"],
            "move_date": (date.today() + timedelta(days=12)).isoformat(),
            "move_method": "movers",
            "notice_period_days": 30,
            "from_city": "Long Beach",
        },
    )
    await insert("items", {"move_id": move["_id"], "name": "Desk", "decision": "SELL", "status": "decided", "category": "Furniture"})
    await insert("items", {"move_id": move["_id"], "name": "Couch", "decision": "HAUL", "status": "decided", "category": "Furniture"})
    tasks = await replan(move)
    lanes = {t["lane"] for t in tasks}
    assert lanes == {"stuff", "transport", "old_home", "new_home", "admin"}
    keys = {t["key"] for t in tasks}
    assert {"haul_quotes", "book_hauler", "mover_quotes", "notice_to_vacate", "usps_forwarding"} <= keys
    assert any(k.startswith("sell:") for k in keys)
    t = next(t for t in tasks if t["key"] == "usps_forwarding")
    await get_db().tasks.update_one({"_id": t["_id"]}, {"$set": {"status": "done"}})
    again = await replan(move)
    assert len(again) == len(tasks)
    assert next(x for x in again if x["key"] == "usps_forwarding")["status"] == "done"
