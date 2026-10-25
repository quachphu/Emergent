"""Pure scheduling math: everything is planned backward from move day. No I/O here (easy to test)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

SELL_LIST_MAX_DAYS = 21  # list 14–21 days before move day
SELL_LIST_MIN_DAYS = 14
PRICE_DROP_EVERY_DAYS = 4
PRICE_DROP_PCT = 0.15
SELL_CUTOFF_DAYS = 5  # unsold at 5 days → HANDOFF or DONATE; no new SELL under 5 days
PICKUP_BOOK_AHEAD_DAYS = 14
CA_DEPOSIT_RETURN_DAYS = 21


def parse_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def days_left(move_date: str | date, today: date | None = None) -> int:
    today = today or date.today()
    return (parse_date(move_date) - today).days


@dataclass
class Due:
    date: date
    tight: bool = False  # the ideal date already passed, so it's due today

    def iso(self) -> str:
        return self.date.isoformat()


def clamp(ideal: date, today: date) -> Due:
    if ideal < today:
        return Due(today, tight=True)
    return Due(ideal)


def list_date(move_date: date, today: date) -> date:
    """List 14–21 days out. With more lead time, wait until 21 days out; with less, list today."""
    dl = (move_date - today).days
    if dl > SELL_LIST_MAX_DAYS:
        return move_date - timedelta(days=SELL_LIST_MAX_DAYS)
    return today


@dataclass
class PricePoint:
    date: str
    price: float
    note: str = ""


@dataclass
class PriceSchedule:
    points: list[PricePoint] = field(default_factory=list)
    cutoff: str = ""
    fallback: str = "HANDOFF or DONATE"


def round_price(p: float) -> float:
    if p >= 20:
        return float(int(round(p / 5.0)) * 5)
    return float(max(1, round(p)))


def price_schedule(start_price: float, move_date: str | date, today: date | None = None) -> PriceSchedule:
    """Start price on the list date, 15% drop every 4 days, stop at move day − 5."""
    today = today or date.today()
    md = parse_date(move_date)
    cutoff = md - timedelta(days=SELL_CUTOFF_DAYS)
    d = list_date(md, today)
    price = float(start_price)
    points = [PricePoint(d.isoformat(), round_price(price), "List")]
    while True:
        d = d + timedelta(days=PRICE_DROP_EVERY_DAYS)
        if d >= cutoff:
            break
        price = price * (1 - PRICE_DROP_PCT)
        points.append(PricePoint(d.isoformat(), round_price(price), "Drop 15%"))
    return PriceSchedule(points=points, cutoff=cutoff.isoformat())


def current_price(schedule: list[dict], today: date | None = None) -> float | None:
    today = today or date.today()
    price = None
    for p in schedule:
        if parse_date(p["date"]) <= today:
            price = p["price"]
    if price is None and schedule:
        price = schedule[0]["price"]
    return price


def pickup_plan(move_date: date, today: date, lead_time_days: int) -> dict:
    """Ideal: book 14 days before a pickup 2 days before move day. If that's impossible,
    book today and take the earliest slot the city allows."""
    ideal_pickup = move_date - timedelta(days=2)
    ideal_book = ideal_pickup - timedelta(days=PICKUP_BOOK_AHEAD_DAYS)
    if ideal_book >= today:
        return {"book_by": ideal_book.isoformat(), "pickup_date": ideal_pickup.isoformat(), "tight": False}
    earliest = today + timedelta(days=max(lead_time_days, 1))
    pickup = max(min(ideal_pickup, move_date - timedelta(days=1)), earliest)
    return {
        "book_by": today.isoformat(),
        "pickup_date": pickup.isoformat(),
        "tight": True,
        "note": f"Less than {PICKUP_BOOK_AHEAD_DAYS} days of lead time — book today.",
    }


def deposit_due(move_date: str | date, state: str = "CA") -> date:
    return parse_date(move_date) + timedelta(days=CA_DEPOSIT_RETURN_DAYS)


def notice_due(move_date: date, today: date, notice_period_days: int) -> Due:
    return clamp(move_date - timedelta(days=notice_period_days), today)


# Static task templates per lane: (key, title, days_before_move (negative = after), clock, notes)
STATIC_TASKS: dict[str, list[tuple[str, str, int, str, str]]] = {
    "stuff": [
        ("scan_home", "Scan your home room by room", 20, "sell", "Photos become an inventory with value ranges."),
        ("decide_items", "Decide keep or let go for every item", 18, "sell", "Swipe through the review deck."),
        ("unsold_cutoff", "Unsold items move to Handoff or Donate", 5, "sell", "Automatic at 5 days out."),
    ],
    "transport": [],
    "old_home": [
        ("notice_to_vacate", "Send notice to vacate", 30, "lease", "Signed by you; Handoff drafts it."),
        ("moveout_photos", "Take timestamped move-out photos", 1, "lease", "Room by room, protects your deposit."),
        ("return_keys", "Return keys and get a receipt", 0, "lease", "Ask for a written key receipt."),
        ("deposit_back", "Security deposit due back", -21, "lease", "California: landlord has 21 days."),
    ],
    "new_home": [
        ("application_packet", "Complete the application packet", 14, "lease", "You upload IDs and sign yourself."),
        ("review_lease", "Review the new lease", 10, "lease", "For your review, not legal advice."),
        ("internet", "Book internet install", 10, "admin", "Installs book 7–10 days out."),
        ("utilities", "Start electricity and gas", 7, "admin", "Start service on move day."),
        ("renters_insurance", "Get renters insurance", 2, "admin", "Many leases require it before keys."),
    ],
    "admin": [
        ("usps_forwarding", "Set up USPS mail forwarding", 14, "admin", "Official site only: usps.com/move."),
        ("employer_address", "Tell your employer your new address", 7, "admin", "Payroll and tax forms."),
        ("bank_address", "Update your bank address", 5, "admin", "You log in yourself."),
        ("subscriptions", "Update subscriptions and deliveries", 3, "admin", "Amazon, meal kits, streaming."),
        ("dmv_address", "Change address with the DMV", -10, "admin", "California: within 10 days of moving."),
        ("voter_registration", "Update voter registration", -14, "admin", "registertovote.ca.gov"),
    ],
}

TRANSPORT_BY_METHOD: dict[str, list[tuple[str, str, int, str, str]]] = {
    "movers": [
        ("mover_quotes", "Get mover quotes", 14, "transport", "Uses your scan inventory as the moving list."),
        ("book_movers", "Book movers", 10, "transport", "Paid with Stripe after you approve."),
        ("moving_day", "Moving day", 0, "transport", ""),
    ],
    "diy_truck": [
        ("reserve_truck", "Reserve a moving truck", 14, "transport", ""),
        ("moving_day", "Moving day", 0, "transport", ""),
    ],
    "shipping": [
        ("ship_boxes", "Ship boxes to the new place", 7, "transport", "Ground freight takes 3–6 days."),
        ("moving_day", "Travel day", 0, "transport", ""),
    ],
    "suitcases": [
        ("pack_suitcases", "Pack suitcases", 1, "transport", ""),
        ("moving_day", "Travel day", 0, "transport", ""),
    ],
}


def task_due(move_date: date, today: date, days_before: int) -> Due:
    ideal = move_date - timedelta(days=days_before)
    if days_before < 0:  # after move day: never "tight"
        return Due(ideal)
    return clamp(ideal, today)
