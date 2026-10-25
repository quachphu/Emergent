"""Paperwork agent: notice-to-vacate, deposit follow-up, lease summary, admin drafts.

Handoff drafts; the user signs and sends. Lease summaries are for review, not legal advice."""

from __future__ import annotations

import re
from datetime import date, timedelta

from ai.llm import text_json
from models.schemas import LeaseFlag, LeaseSummary, Letter

from .schedule import deposit_due, parse_date

LEGAL_NOTE = "For your review, not legal advice."


def _fmt(d: date) -> str:
    return d.strftime("%B %-d, %Y")


def notice_letter_fallback(user: dict, move: dict, today: date | None = None) -> Letter:
    today = today or date.today()
    md = parse_date(move["move_date"])
    landlord = move.get("landlord_name") or "[Landlord or property manager name]"
    body = f"""{_fmt(today)}

To: {landlord}
Re: Notice of intent to vacate — {move.get('from_address')}

Dear {landlord},

This letter is my written notice that I will vacate the unit at {move.get('from_address')} on {_fmt(md)}. I will return all keys on that date and can schedule a move-out walk-through with you during my last week.

Please send my security deposit, with any itemized deductions, within 21 days of move-out as required by California Civil Code §1950.5, to my forwarding address:

{move.get('to_address')}

Thank you for being my landlord. You can reach me at {user.get('email')}.

Sincerely,

______________________________
{user.get('name')}
(Sign here — Handoff never signs for you.)"""
    return Letter(subject=f"Notice to vacate — {move.get('from_address')}", body=body)


async def notice_letter(user: dict, move: dict) -> tuple[Letter, str]:
    prompt = (
        "Polish this notice-to-vacate letter. Keep every fact, date, address and the signature line exactly; "
        "keep it short and polite. Do not add anything the tenant must sign on their behalf.\n\n" + notice_letter_fallback(user, move).body
    )
    result = await text_json(Letter, prompt, fallback=lambda: notice_letter_fallback(user, move))
    letter = result.value
    if "____" not in letter.body:  # signature line must survive
        letter = notice_letter_fallback(user, move)
    return letter, result.source


def notice_status(move: dict, today: date | None = None) -> dict:
    today = today or date.today()
    md = parse_date(move["move_date"])
    period = int(move.get("notice_period_days") or 30)
    ideal = md - timedelta(days=period)
    short_by = max(0, (today - ideal).days)
    return {
        "notice_period_days": period,
        "ideal_send_date": ideal.isoformat(),
        "late": short_by > 0,
        "short_by_days": short_by,
        "rent_through": (today + timedelta(days=period)).isoformat() if short_by else md.isoformat(),
        "message": (
            f"Your lease asks for {period} days' notice. Sending today covers you through "
            f"{_fmt(today + timedelta(days=period))}; ask your landlord about ending on move day."
            if short_by
            else f"Send by {_fmt(ideal)} to give {period} days' notice."
        ),
    }


def deposit_letter(user: dict, move: dict) -> Letter:
    due = deposit_due(move["move_date"])
    landlord = move.get("landlord_name") or "[Landlord or property manager name]"
    body = f"""Dear {landlord},

I moved out of {move.get('from_address')} on {_fmt(parse_date(move['move_date']))} and returned all keys. Under California Civil Code §1950.5, my security deposit and any itemized statement of deductions were due by {_fmt(due)}.

Please send the deposit to {move.get('to_address')} within 7 days. I have dated move-out photos of every room.

Thank you,
{user.get('name')}"""
    return Letter(subject="Security deposit follow-up", body=body)


# ---------------- lease summary ----------------

_RULES: list[tuple[str, str, str, str]] = [
    (r"late (?:fee|charge)[^.]*", "fees", "medium", "Late fees in California must be a reasonable estimate of the landlord's cost."),
    (r"non-?refundable[^.]*", "fees", "high", "California deposits must be refundable; 'non-refundable' fees deserve a question."),
    (r"(?:move-?in|admin(?:istrative)?|amenity|processing) fee[^.]*", "fees", "medium", "One-time fees add to your move-in cost."),
    (r"automatic(?:ally)? renew[^.]*|month-to-month[^.]*unless[^.]*", "renewal", "medium", "Know the deadline to give notice so you don't renew by accident."),
    (r"(\d+)\s*days?['’]?\s*(?:prior\s+)?(?:written\s+)?notice[^.]*", "notice_period", "medium", "Put the notice deadline on your calendar."),
    (r"security deposit[^.]*", "deposit", "low", "Deposit must be returned within 21 days of move-out (CA)."),
    (
        r"(?:professional(?:ly)?|carpet) clean(?:ing|ed)[^.]*",
        "unusual",
        "medium",
        "Automatic cleaning charges may not be deductible beyond normal wear and tear.",
    ),
    (r"early termination[^.]*", "fees", "high", "Know the cost of leaving early."),
    (r"pet (?:rent|fee|deposit)[^.]*", "pets", "low", "Recurring pet rent adds to monthly cost."),
    (r"guests?[^.]*(?:\d+\s*(?:consecutive\s*)?(?:days|nights))[^.]*", "unusual", "low", "Guest limits can matter for visiting family."),
    (r"renters'? insurance[^.]*", "other", "low", "You'll need proof of insurance before move-in."),
    (r"(?:waive|waiver)[^.]*", "unusual", "high", "Tenants generally can't waive rights given by California law."),
]


def _money(text: str, pattern: str) -> str | None:
    m = re.search(pattern, text, re.I | re.S)
    return f"${m.group(1)}" if m else None


def lease_summary_fallback(text: str) -> LeaseSummary:
    # Drop numbered section headings ("5. Move-in Fee") so quoted clauses read cleanly.
    t = re.sub(r"(^|\n)\s*\d+\.\s+[^\n]{1,40}\n", ". ", text or "")
    t = re.sub(r"\s+", " ", t).lstrip(". ")
    rent = _money(t, r"(?:monthly )?rent[^$.]{0,60}\$\s?([\d,]+(?:\.\d{2})?)")
    deposit = _money(t, r"security deposit[^$.]{0,60}\$\s?([\d,]+(?:\.\d{2})?)")
    term_m = re.search(r"(\d{1,2})[- ]month", t, re.I)
    term = f"{term_m.group(1)} months" if term_m else None
    notice_m = re.search(r"(\d+)\s*days?['’]?\s*(?:prior\s+)?(?:written\s+)?notice", t, re.I)
    notice = f"{notice_m.group(1)} days" if notice_m else None
    flags: list[LeaseFlag] = []
    seen: set[str] = set()
    for pattern, cat, sev, why in _RULES:
        for m in re.finditer(pattern, t, re.I):
            clause = m.group(0).strip()[:220]
            key = clause[:60].lower()
            if key in seen or any(key in k or k in key for k in seen):
                continue
            seen.add(key)
            flags.append(LeaseFlag(clause=clause, category=cat, severity=sev, explanation=why))
            break
    summary = [
        s
        for s in [
            f"Rent is {rent} per month." if rent else None,
            f"Lease term: {term}." if term else None,
            f"Security deposit: {deposit}." if deposit else None,
            f"Notice to end or not renew: {notice}." if notice else None,
            f"{len(flags)} clauses worth a closer look." if flags else "No unusual clauses found by the quick scan.",
        ]
        if s
    ]
    questions = []
    cats = {f.category for f in flags}
    if "fees" in cats:
        questions.append("Can you list every one-time and recurring fee in writing?")
    if any("non-refundable" in f.clause.lower() for f in flags):
        questions.append("Which part of the 'non-refundable' fee is refundable under California law?")
    if "renewal" in cats:
        questions.append("What date do I need to give notice by to avoid automatic renewal?")
    if any("clean" in f.clause.lower() for f in flags):
        questions.append("Is the cleaning charge waived if I leave the unit clean?")
    questions.append("Who do I contact for maintenance emergencies, and how fast do you respond?")
    questions.append("Is parking or storage included?")
    return LeaseSummary(summary=summary, rent=rent, term=term, deposit=deposit, notice_period=notice, flags=flags, questions=questions[:6])


async def lease_summary(text: str) -> tuple[LeaseSummary, str]:
    prompt = (
        "Summarize this residential lease for a first-time renter in plain language. "
        "summary: 4-6 short bullets. Flag clauses about fees, notice period, renewal, deposit, and unusual terms "
        "(quote the clause, rate severity, explain in one sentence, California context). "
        "questions: 3-6 questions to ask the landlord. This is for the tenant's review, not legal advice.\n\nLEASE:\n" + (text or "")[:60000]
    )
    result = await text_json(LeaseSummary, prompt, fallback=lambda: lease_summary_fallback(text), effort="medium")
    return result.value, result.source


# ---------------- admin ----------------


def admin_checklist(user: dict, move: dict) -> list[dict]:
    md = parse_date(move["move_date"])
    name, to_addr, from_addr = user.get("name"), move.get("to_address"), move.get("from_address")
    work = move.get("employer") or "your employer"
    return [
        {
            "key": "usps_forwarding",
            "title": "USPS change of address",
            "due": (md - timedelta(days=14)).isoformat(),
            "link": "https://moversguide.usps.com/",
            "how": "Only use the official USPS site (it charges a $1.10 identity check). Start forwarding on move day.",
            "draft": None,
        },
        {
            "key": "employer_address",
            "title": f"Tell {work}",
            "due": (md - timedelta(days=7)).isoformat(),
            "link": None,
            "how": "Update your address for payroll and tax forms (W-4/state withholding may change).",
            "draft": {
                "subject": "Address change",
                "body": f"Hi,\n\nI'm relocating to {to_addr} on {_fmt(md)}. Please update my mailing address for payroll and tax documents, and let me know if I need to update any state withholding forms.\n\nThanks,\n{name}",
            },
        },
        {
            "key": "bank_address",
            "title": "Bank and credit cards",
            "due": (md - timedelta(days=5)).isoformat(),
            "link": None,
            "how": "Log in to each bank yourself and update your address. Handoff never asks for bank logins.",
            "draft": {
                "subject": "Update mailing address",
                "body": f"Hello,\n\nPlease update my mailing address from {from_addr} to {to_addr}, effective {_fmt(md)}.\n\nThank you,\n{name}",
            },
        },
        {
            "key": "subscriptions",
            "title": "Subscriptions and deliveries",
            "due": (md - timedelta(days=3)).isoformat(),
            "link": None,
            "how": "Amazon, meal kits, streaming, gym — update or cancel.",
            "draft": {
                "subject": "Cancel or move my membership",
                "body": f"Hi,\n\nI'm moving to {to_addr} on {_fmt(md)}. Please cancel or transfer my membership as of that date.\n\nThanks,\n{name}",
            },
        },
        {
            "key": "dmv_address",
            "title": "DMV address change",
            "due": (md + timedelta(days=10)).isoformat(),
            "link": "https://www.dmv.ca.gov/portal/customer-service/request-vehicle-or-driver-records/online-change-of-address-coa-system/",
            "how": "California requires it within 10 days of moving. You submit it yourself.",
            "draft": None,
        },
        {
            "key": "voter_registration",
            "title": "Voter registration",
            "due": (md + timedelta(days=14)).isoformat(),
            "link": "https://registertovote.ca.gov/",
            "how": "Re-register at your new address.",
            "draft": None,
        },
    ]


def utilities_plan(move: dict) -> list[dict]:
    md = parse_date(move["move_date"])
    city = (move.get("to_city") or "").lower()
    power = "PG&E" if "francisco" in city else "your local utility"
    return [
        {
            "key": "utilities",
            "title": f"Electricity and gas ({power})",
            "start": md.isoformat(),
            "book_by": (md - timedelta(days=7)).isoformat(),
            "lead_days": 7,
            "link": "https://www.pge.com/en/account/service-requests/start-stop-or-move-service.html" if power == "PG&E" else None,
        },
        {
            "key": "internet",
            "title": "Internet install",
            "start": (md + timedelta(days=1)).isoformat(),
            "book_by": (md - timedelta(days=10)).isoformat(),
            "lead_days": 10,
            "link": None,
        },
        {
            "key": "renters_insurance",
            "title": "Renters insurance",
            "start": md.isoformat(),
            "book_by": (md - timedelta(days=2)).isoformat(),
            "lead_days": 1,
            "link": None,
        },
    ]


APPLICATION_PACKET = [
    {"key": "id", "title": "Photo ID", "note": "You upload it to the landlord's portal yourself. Handoff never stores ID numbers."},
    {"key": "offer_letter", "title": "Offer letter or proof of income", "note": "Job offer letter usually works for new grads."},
    {"key": "references", "title": "Rental references", "note": "Current landlord contact."},
    {"key": "credit", "title": "Credit report", "note": "Landlord runs it with your consent; you enter details on their site."},
    {"key": "fee", "title": "Application fee", "note": "California caps screening fees; pay on the landlord's portal."},
]
