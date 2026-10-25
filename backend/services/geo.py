"""Geocoding (Mapbox when MAPBOX_TOKEN is set and reachable) with a built-in California gazetteer
fallback, plus distance / commute estimates."""

from __future__ import annotations

import hashlib
import logging
import math
import re
import time

import httpx

from core.config import get_settings

log = logging.getLogger("handoff.geo")
_down_until = 0.0

# name → (lng, lat, city)
GAZETTEER: dict[str, tuple[float, float, str]] = {
    # San Francisco neighborhoods
    "mission district": (-122.4194, 37.7599, "San Francisco"),
    "mission": (-122.4194, 37.7599, "San Francisco"),
    "soma": (-122.4005, 37.7785, "San Francisco"),
    "south of market": (-122.4005, 37.7785, "San Francisco"),
    "financial district": (-122.3999, 37.7946, "San Francisco"),
    "market st": (-122.4014, 37.7897, "San Francisco"),
    "noe valley": (-122.4331, 37.7502, "San Francisco"),
    "sunset": (-122.4944, 37.7536, "San Francisco"),
    "richmond": (-122.4829, 37.7799, "San Francisco"),
    "nob hill": (-122.4153, 37.7930, "San Francisco"),
    "hayes valley": (-122.4241, 37.7759, "San Francisco"),
    "dogpatch": (-122.3890, 37.7605, "San Francisco"),
    "potrero": (-122.4006, 37.7611, "San Francisco"),
    "castro": (-122.4350, 37.7609, "San Francisco"),
    "marina": (-122.4368, 37.8037, "San Francisco"),
    "bernal": (-122.4156, 37.7390, "San Francisco"),
    "san francisco": (-122.4194, 37.7749, "San Francisco"),
    "sf": (-122.4194, 37.7749, "San Francisco"),
    # Long Beach neighborhoods
    "belmont shore": (-118.1360, 33.7586, "Long Beach"),
    "belmont heights": (-118.1436, 33.7656, "Long Beach"),
    "bixby knolls": (-118.1937, 33.8350, "Long Beach"),
    "alamitos beach": (-118.1720, 33.7682, "Long Beach"),
    "downtown long beach": (-118.1937, 33.7701, "Long Beach"),
    "long beach": (-118.1937, 33.7701, "Long Beach"),
    # Other CA cities
    "los angeles": (-118.2437, 34.0522, "Los Angeles"),
    "oakland": (-122.2712, 37.8044, "Oakland"),
    "berkeley": (-122.2730, 37.8715, "Berkeley"),
    "san jose": (-121.8863, 37.3382, "San Jose"),
    "palo alto": (-122.1430, 37.4419, "Palo Alto"),
    "mountain view": (-122.0839, 37.3861, "Mountain View"),
    "san diego": (-117.1611, 32.7157, "San Diego"),
    "irvine": (-117.8265, 33.6846, "Irvine"),
    "sacramento": (-121.4944, 38.5816, "Sacramento"),
    "seattle": (-122.3321, 47.6062, "Seattle"),
    "new york": (-74.0060, 40.7128, "New York"),
    "austin": (-97.7431, 30.2672, "Austin"),
}
_KEYS = sorted(GAZETTEER, key=len, reverse=True)


def _jitter(address: str, scale: float = 0.012) -> tuple[float, float]:
    h = hashlib.sha256(address.lower().encode()).digest()
    dx = (h[0] / 255 - 0.5) * scale
    dy = (h[1] / 255 - 0.5) * scale
    return dx, dy


def gazetteer_lookup(address: str) -> dict | None:
    text = " " + re.sub(r"[^a-z0-9]+", " ", address.lower()) + " "
    for key in _KEYS:
        if f" {key} " in text:
            lng, lat, city = GAZETTEER[key]
            dx, dy = _jitter(address) if key != text.strip() else (0.0, 0.0)
            return {
                "geo": {"type": "Point", "coordinates": [round(lng + dx, 6), round(lat + dy, 6)]},
                "city": city,
                "label": address.strip(),
                "source": "gazetteer",
                "approximate": True,
            }
    return None


async def geocode(address: str) -> dict | None:
    global _down_until
    s = get_settings()
    if s.mapbox_token and time.time() >= _down_until:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.get(
                    "https://api.mapbox.com/search/geocode/v6/forward",
                    params={"q": address, "access_token": s.mapbox_token, "limit": 1, "country": "us"},
                )
                resp.raise_for_status()
                feats = resp.json().get("features") or []
                if feats:
                    f = feats[0]
                    ctx = f.get("properties", {}).get("context", {})
                    city = (ctx.get("place") or {}).get("name") or ""
                    return {
                        "geo": {"type": "Point", "coordinates": f["geometry"]["coordinates"]},
                        "city": city,
                        "label": f.get("properties", {}).get("full_address") or address,
                        "source": "mapbox",
                        "approximate": False,
                    }
        except Exception as exc:  # noqa: BLE001
            log.warning("mapbox geocoding unavailable (%s); using gazetteer", type(exc).__name__)
            _down_until = time.time() + 120
    return gazetteer_lookup(address)


def haversine_miles(a: list[float] | None, b: list[float] | None) -> float | None:
    if not a or not b:
        return None
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    d = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(d))


def driving_miles(a, b) -> float | None:
    straight = haversine_miles(a, b)
    return None if straight is None else round(straight * 1.22, 1)


def commute_minutes(a, b) -> int | None:
    """Rough city commute estimate (transit/drive mix, ~11 mph door to door + 6 min overhead)."""
    miles = haversine_miles(a, b)
    if miles is None:
        return None
    return int(round(miles * 1.3 / 11 * 60 + 6))


def city_of(geo_result: dict | None, address: str) -> str:
    if geo_result and geo_result.get("city"):
        return geo_result["city"]
    hit = gazetteer_lookup(address)
    return hit["city"] if hit else ""


def area_label(address: str, city: str) -> str:
    """Neighborhood + city, without the street address (what vendors and arrivals see)."""
    text = " " + re.sub(r"[^a-z0-9]+", " ", (address or "").lower()) + " "
    for key in _KEYS:
        lng, lat, c = GAZETTEER[key]
        if c == city and key not in {city.lower(), "sf", "downtown long beach"} and f" {key} " in text:
            return f"{key.title()}, {city}"
    return city or (address.split(",")[-2].strip() if "," in address else address)
