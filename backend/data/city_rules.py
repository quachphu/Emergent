"""City rules for free pickups, donation and disposal. Demo reference data — users should confirm
with the city before relying on it (shown in the UI with the source link)."""

from __future__ import annotations

CITY_RULES: list[dict] = [
    # ---------------- Long Beach, CA (origin) ----------------
    {
        "city": "Long Beach",
        "category": "bulky",
        "program": "Special Collection (bulky item pickup)",
        "steps": [
            "Request a Special Collection online or by phone with your address and item list.",
            "Get a confirmation number and your collection date.",
            "Night before: place items at the curb by your trash bins, not blocking the sidewalk.",
            "Keep the confirmation number until the items are gone.",
        ],
        "lead_time_days": 5,
        "applies_to": ["Furniture", "Bedroom", "Decor"],
        "notes": "Residents with city trash service get free bulky item pickups each year. Mattresses accepted.",
        "source_url": "https://www.longbeach.gov/lbrecycles/",
        "free": True,
    },
    {
        "city": "Long Beach",
        "category": "mattress",
        "program": "Bye Bye Mattress (CA mattress recycling)",
        "steps": [
            "Find the nearest free mattress drop-off site, or include the mattress in a Special Collection.",
            "Keep the mattress dry — wet mattresses can be refused.",
        ],
        "lead_time_days": 5,
        "applies_to": ["Bedroom"],
        "notes": "California funds free mattress recycling through a fee paid at purchase.",
        "source_url": "https://byebyemattress.com/",
        "free": True,
    },
    {
        "city": "Long Beach",
        "category": "e-waste",
        "program": "E-waste drop-off",
        "steps": [
            "Bring TVs, monitors and electronics to a certified e-waste drop-off event or center.",
            "Never put electronics in trash bins (illegal in CA).",
        ],
        "lead_time_days": 0,
        "applies_to": ["Electronics"],
        "notes": "TVs and monitors are universal waste in California.",
        "source_url": "https://www.longbeach.gov/lbrecycles/",
        "free": True,
    },
    {
        "city": "Long Beach",
        "category": "donation",
        "program": "Goodwill SoCal / Habitat ReStore donation",
        "steps": ["Drop off clean, working items during open hours.", "Ask for a donation receipt for taxes."],
        "lead_time_days": 0,
        "applies_to": ["Furniture", "Kitchen", "Decor", "Books", "Lighting"],
        "notes": "ReStore offers free pickup for large furniture in good condition (schedule ahead).",
        "source_url": "https://www.habitatlb.org/restore",
        "free": True,
    },
    # ---------------- San Francisco, CA (destination) ----------------
    {
        "city": "San Francisco",
        "category": "bulky",
        "program": "Recology Bulky Item Recycling",
        "steps": [
            "Schedule online or call Recology with your account and item list.",
            "Night before: place items at the curb or agreed location after 6 pm.",
            "Items must fit the pickup volume limit (about 10 items or 1 cubic yard per pickup).",
        ],
        "lead_time_days": 7,
        "applies_to": ["Furniture", "Bedroom", "Electronics", "Decor"],
        "notes": "Residential customers get free bulky item pickups each year.",
        "source_url": "https://www.recology.com/recology-san-francisco/bulky-item-recycling/",
        "free": True,
    },
    {
        "city": "San Francisco",
        "category": "donation",
        "program": "Goodwill SF / St. Vincent de Paul",
        "steps": ["Drop off at a donation center or schedule a free furniture pickup."],
        "lead_time_days": 3,
        "applies_to": ["Furniture", "Kitchen", "Decor", "Books", "Lighting"],
        "notes": "Pickup availability varies by neighborhood.",
        "source_url": "https://sfgoodwill.org/donate/",
        "free": True,
    },
]


def rules_for(city: str) -> list[dict]:
    c = (city or "").lower()
    return [r for r in CITY_RULES if r["city"].lower() in c or c in r["city"].lower()]


def pickup_rule(city: str, category: str) -> dict | None:
    rules = rules_for(city)
    if category == "Bedroom":
        for r in rules:
            if r["category"] == "bulky":
                return r
    if category == "Electronics":
        for r in rules:
            if r["category"] == "e-waste":
                return r
    for r in rules:
        if r["category"] == "bulky" and category in r["applies_to"]:
            return r
    return next((r for r in rules if r["category"] == "bulky"), None)


# Approximate locations, for the map only.
DONATION_SITES: list[dict] = [
    {"name": "Habitat for Humanity ReStore", "city": "Long Beach", "coordinates": [-118.1890, 33.8030], "accepts": "Furniture, appliances, decor"},
    {"name": "Goodwill Donation Center", "city": "Long Beach", "coordinates": [-118.1300, 33.7700], "accepts": "Clothes, housewares, small furniture"},
    {"name": "Salvation Army Family Store", "city": "Long Beach", "coordinates": [-118.1730, 33.7880], "accepts": "Furniture, clothes"},
    {"name": "Goodwill SF — Mission", "city": "San Francisco", "coordinates": [-122.4190, 37.7620], "accepts": "Clothes, housewares"},
    {"name": "St. Vincent de Paul Thrift", "city": "San Francisco", "coordinates": [-122.4060, 37.7720], "accepts": "Furniture pickups"},
]
