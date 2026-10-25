"""Keep-or-let-go agent: one decision and a one-line reason per item.

Hard rules (enforced after the model answers, so they always hold):
  - No SELL when fewer than 5 days are left.
  - Prefer HANDOFF over DONATE when a matching arrival need exists.
"""

from __future__ import annotations

from ai.llm import text_json
from models.schemas import DecisionOut

from .schedule import SELL_CUTOFF_DAYS

LET_GO = ["SELL", "HANDOFF", "DONATE", "RECYCLE", "CITY_PICKUP", "HAUL"]


def _mid(item: dict) -> float:
    return ((item.get("resale_low") or 0) + (item.get("resale_high") or 0)) / 2


def _is_mattress(item: dict) -> bool:
    return "mattress" in (item.get("name") or "").lower()


def rule_decision(
    item: dict,
    days_left: int,
    *,
    has_match: bool = False,
    priorities: dict | None = None,
    move_method: str = "movers",
    allow_keep: bool = True,
) -> tuple[str, str]:
    """Deterministic decision. Also the fallback when the model is unavailable."""
    p = priorities or {}
    cash, speed, landfill = p.get("cash", 50), p.get("speed", 50), p.get("landfill", 50)
    size = item.get("size") or "M"
    cond = int(item.get("condition") or 3)
    mid = _mid(item)
    move_cost = float(item.get("move_cost_estimate") or 0)
    replace = float(item.get("replacement_cost_estimate") or 0)
    category = item.get("category") or ""

    if allow_keep:
        big = size in {"L", "XL"}
        portable = not big and move_method != "suitcases"
        keep_value = replace - move_cost - mid
        if portable and keep_value >= 90 and cond >= 3:
            return "KEEP", f"Costs ~${int(replace)} to replace and only ~${int(move_cost)} to move."
        if category == "Books" and move_method in {"shipping", "movers"} and cond >= 3:
            return "KEEP", "Cheap to ship by media mail and hard to replace."
        if move_method == "movers" and big and keep_value >= 250 and cond >= 4:
            return "KEEP", "Worth more to you than the movers charge to bring it."

    if _is_mattress(item):
        return "CITY_PICKUP", "Mattresses can't be resold or donated easily; the city picks them up free."
    if cond <= 1:
        return "RECYCLE", "Too worn to reuse; recycle it responsibly."
    if has_match and (landfill >= 40 or mid < 80):
        return "HANDOFF", "Someone arriving in town needs one — it stays out of the landfill."
    can_sell = days_left >= SELL_CUTOFF_DAYS
    if can_sell and mid >= 40 and cond >= 3 and (cash >= 40 or mid >= 100) and not (speed >= 80 and mid < 80):
        return "SELL", f"Likely sells for ${int(item.get('resale_low') or 0)}–${int(item.get('resale_high') or 0)} with {days_left} days left."
    if has_match:
        return "HANDOFF", "An arrival needs one; a free handoff is faster than selling."
    if size in {"L", "XL"}:
        if cond <= 2:
            return "CITY_PICKUP", "Bulky and worn — a free city pickup is the cheapest exit."
        return "HAUL", "Too big to donate by car; bundle it into one haul-away job."
    return "DONATE", "Small and still useful — a quick donation drop-off."


def enforce_rules(decision: str, reason: str, days_left: int, has_match: bool) -> tuple[str, str]:
    if decision == "SELL" and days_left < SELL_CUTOFF_DAYS:
        if has_match:
            return "HANDOFF", f"Only {days_left} days left — too late to sell, and an arrival needs it."
        return "DONATE", f"Only {days_left} days left — too late to sell, so donate it."
    if decision == "DONATE" and has_match:
        return "HANDOFF", "An arrival needs exactly this — hand it off instead of donating."
    return decision, reason


async def decide(
    item: dict,
    days_left: int,
    *,
    has_match: bool = False,
    priorities: dict | None = None,
    move_method: str = "movers",
    allow_keep: bool = True,
    use_model: bool = True,
) -> tuple[str, str, str]:
    """Returns (decision, reason, source)."""

    def fallback() -> DecisionOut:
        d, r = rule_decision(item, days_left, has_match=has_match, priorities=priorities, move_method=move_method, allow_keep=allow_keep)
        return DecisionOut(decision=d, reason=r)

    if use_model:
        options = (["KEEP"] if allow_keep else []) + LET_GO
        prompt = (
            "Decide what to do with this household item before a move. "
            f"Options: {', '.join(options)}. Reply with a decision and one short reason (max 14 words).\n"
            f"Item: {item.get('name')} ({item.get('category')}), condition {item.get('condition')}/5, size {item.get('size')}.\n"
            f"Resale estimate ${item.get('resale_low')}–${item.get('resale_high')}, move cost ~${item.get('move_cost_estimate')}, "
            f"replacement ~${item.get('replacement_cost_estimate')}.\n"
            f"Days until move: {days_left}. Move method: {move_method}. Priorities (0-100): {priorities}.\n"
            f"An arrival in the city needs this kind of item: {'yes' if has_match else 'no'}.\n"
            "Rules: never SELL with fewer than 5 days left; prefer HANDOFF over DONATE when an arrival needs it; "
            "mattresses go to CITY_PICKUP."
        )
        result = await text_json(DecisionOut, prompt, fallback=fallback)
        out, source = result.value, result.source
    else:
        out, source = fallback(), "fallback"
    decision = out.decision
    if not allow_keep and decision == "KEEP":
        fb = fallback()
        decision, out = fb.decision, fb
    decision, reason = enforce_rules(decision, out.reason, days_left, has_match)
    return decision, reason, source
