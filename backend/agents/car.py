"""Car: estimate make/model/year/mileage/value from photos; sell or ship."""

from __future__ import annotations

import re
from datetime import date

from ai.llm import Image, vision_json
from models.schemas import CarEstimate

MSRP = {
    "honda": 26000,
    "toyota": 27000,
    "subaru": 29000,
    "mazda": 26000,
    "hyundai": 24000,
    "kia": 23000,
    "ford": 30000,
    "chevrolet": 28000,
    "nissan": 25000,
    "volkswagen": 28000,
    "tesla": 45000,
    "bmw": 45000,
}
MODELS = {
    "civic": "honda",
    "accord": "honda",
    "corolla": "toyota",
    "camry": "toyota",
    "prius": "toyota",
    "rav4": "toyota",
    "outback": "subaru",
    "impreza": "subaru",
    "mazda3": "mazda",
    "elantra": "hyundai",
    "model 3": "tesla",
    "golf": "volkswagen",
}


def value_range(make: str, year: int, mileage: int | None) -> tuple[float, float]:
    msrp = MSRP.get((make or "").lower(), 27000)
    age = max(0, date.today().year - int(year))
    value = msrp * (0.85**age)
    miles = mileage if mileage is not None else age * 11000
    value -= max(0, miles - age * 12000) * 0.06
    value = max(value, 1500)
    return round(value * 0.9 / 100) * 100, round(value * 1.1 / 100) * 100


def fallback_estimate(hint: str = "") -> CarEstimate:
    h = (hint or "").lower()
    make, model = "Honda", "Civic"
    for m, mk in MODELS.items():
        if m in h:
            make, model = mk.title(), m.title()
            break
    y = re.search(r"(19|20)\d{2}", h)
    year = int(y.group(0)) if y else 2017
    mi = re.search(r"(\d{2,3})[,]?(\d{3})\s*(?:mi|miles)", h)
    mileage = int(mi.group(1) + mi.group(2)) if mi else 68000
    lo, hi = value_range(make, year, mileage)
    return CarEstimate(make=make, model=model, year=year, mileage=mileage, value_low=lo, value_high=hi, confidence=0.3)


async def estimate(images: list[Image], hint: str = "") -> tuple[CarEstimate, str]:
    prompt = (
        "Identify this car (make, model, year) and read the odometer if visible. Estimate a private-party value range in USD "
        "for California. If the odometer is not visible, set mileage to null." + (f" Owner's note: {hint}" if hint else "")
    )
    result = await vision_json(images, CarEstimate, prompt, fallback=lambda: fallback_estimate(hint + " " + " ".join(i.name for i in images)))
    est = result.value
    if est.value_high < est.value_low:
        est.value_low, est.value_high = est.value_high, est.value_low
    return est, result.source


SELL_CHECKLIST = [
    "Find your title (pink slip). You sign it yourself at sale.",
    "Get a smog certificate (seller's responsibility in California, valid 90 days).",
    "Clear personal items and remove toll tags.",
    "Meet buyers in daylight at a public place; accept cash or a cashier's check verified at the bank.",
    "Complete the Notice of Transfer and Release of Liability (NRL) with the DMV within 5 days.",
    "Cancel insurance after the NRL is filed.",
]
SHIP_CHECKLIST = [
    "Get 2–3 auto-transport quotes (Handoff texts them after you approve).",
    "Leave less than 1/4 tank of gas and remove personal items.",
    "Photograph every side of the car at pickup.",
    "Have someone available at pickup and delivery to sign the bill of lading.",
]
