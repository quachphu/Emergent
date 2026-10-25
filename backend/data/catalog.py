"""Reference catalog of common household items.

Used by the offline vision fallback (keyword match on file names / hints) and as a sanity prior for
pricing. All money values are estimates based on similar items (USD, Bay Area / SoCal used market).
"""

from __future__ import annotations

import re

# key: (keywords, name, category, size, dims, resale_low, resale_high, move_cost, replacement, weight_lbs)
_ROWS = [
    (
        "office_chair",
        ["office chair", "desk chair", "task chair", "ergonomic", "chair"],
        "Office chair",
        "Furniture",
        "M",
        '26" W x 26" D x 40" H',
        40,
        90,
        35,
        220,
        35,
    ),
    ("dining_chair", ["dining chair", "wood chair", "side chair"], "Dining chair", "Furniture", "M", '18" W x 20" D x 34" H', 15, 40, 20, 90, 15),
    ("desk", ["writing desk", "standing desk", "computer desk", "desk"], "Desk", "Furniture", "L", '48" W x 24" D x 30" H', 60, 140, 60, 280, 55),
    ("dining_table", ["dining table", "kitchen table", "table"], "Dining table", "Furniture", "L", '48" W x 30" D x 30" H', 70, 160, 70, 350, 60),
    (
        "side_table",
        ["side table", "end table", "nightstand", "night stand", "bedside"],
        "Side table",
        "Furniture",
        "S",
        '18" W x 18" D x 22" H',
        15,
        40,
        15,
        80,
        12,
    ),
    ("bookshelf", ["bookshelf", "bookcase", "shelf", "shelving"], "Bookshelf", "Furniture", "L", '30" W x 12" D x 70" H', 25, 70, 50, 150, 45),
    ("mattress", ["mattress"], "Queen mattress", "Bedroom", "XL", '60" W x 80" L x 10" H', 0, 60, 90, 650, 70),
    ("bed_frame", ["bed frame", "bedframe", "platform bed", "bed"], "Queen bed frame", "Bedroom", "XL", '62" W x 84" L x 14" H', 40, 110, 85, 300, 65),
    ("tv", ["television", "tv", "smart tv"], '43" TV', "Electronics", "M", '38" W x 3" D x 22" H', 90, 180, 40, 350, 20),
    ("monitor", ["monitor", "display", "screen"], '27" monitor', "Electronics", "M", '24" W x 8" D x 18" H', 60, 130, 25, 260, 12),
    ("lamp", ["floor lamp", "table lamp", "lamp", "light"], "Floor lamp", "Lighting", "M", '12" W x 12" D x 62" H', 10, 35, 15, 70, 8),
    ("microwave", ["microwave"], "Microwave", "Kitchen", "M", '20" W x 15" D x 12" H', 20, 45, 20, 120, 30),
    ("couch", ["couch", "sofa", "loveseat", "sectional"], "3-seat couch", "Furniture", "XL", '84" W x 36" D x 34" H', 120, 300, 150, 900, 110),
    ("rug", ["area rug", "rug", "carpet"], "Area rug 5x7", "Decor", "M", "5' x 7'", 20, 60, 20, 160, 15),
    ("plant", ["plant", "monstera", "fiddle", "houseplant", "pothos"], "Potted plant", "Decor", "S", '14" pot, 36" tall', 10, 35, 25, 60, 18),
    ("books", ["box of books", "books", "book box", "book"], "Box of books", "Books", "S", '18" x 12" x 12" box', 10, 30, 10, 150, 35),
    ("dresser", ["dresser", "drawers", "chest of drawers"], "Dresser", "Bedroom", "L", '48" W x 18" D x 32" H', 60, 150, 70, 400, 90),
    ("bike", ["bicycle", "bike"], "Bicycle", "Sports", "L", '68" L', 80, 220, 40, 500, 25),
    ("coffee_table", ["coffee table"], "Coffee table", "Furniture", "M", '40" W x 22" D x 18" H', 30, 80, 35, 200, 30),
]

CATALOG: dict[str, dict] = {}
for key, kws, name, cat, size, dims, lo, hi, mv, rep, wt in _ROWS:
    CATALOG[key] = {
        "key": key,
        "keywords": kws,
        "name": name,
        "category": cat,
        "size": size,
        "dims_estimate": dims,
        "resale_low": lo,
        "resale_high": hi,
        "move_cost_estimate": mv,
        "replacement_cost_estimate": rep,
        "weight_lbs": wt,
    }

# Longest keywords first so "office chair" wins over "chair" and "coffee table" over "table".
_KEYWORDS = sorted(((kw, key) for key, row in CATALOG.items() for kw in row["keywords"]), key=lambda x: -len(x[0]))


def match(text: str) -> dict | None:
    t = " " + re.sub(r"[^a-z0-9]+", " ", (text or "").lower()) + " "
    for kw, key in _KEYWORDS:
        if f" {kw} " in t or f" {kw}s " in t:
            return CATALOG[key]
    return None


def weight_for(category: str, size: str) -> float:
    base = {"S": 10, "M": 25, "L": 55, "XL": 90}.get(size or "M", 25)
    return float(base)
