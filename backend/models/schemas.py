"""Pydantic models: request bodies, enums and the strict JSON schemas the AI must return."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

# ---------- enums ----------


class Lane(str, Enum):
    stuff = "stuff"
    transport = "transport"
    old_home = "old_home"
    new_home = "new_home"
    admin = "admin"


LANES = [lane.value for lane in Lane]

LANE_META = {
    "stuff": {"emoji": "📦", "label": "Stuff"},
    "transport": {"emoji": "🚚", "label": "Transport"},
    "old_home": {"emoji": "🔑", "label": "Old home"},
    "new_home": {"emoji": "🏠", "label": "New home"},
    "admin": {"emoji": "🗂️", "label": "Admin & money"},
}

Decision = Literal["KEEP", "SELL", "HANDOFF", "DONATE", "RECYCLE", "CITY_PICKUP", "HAUL"]
DECISIONS = ["KEEP", "SELL", "HANDOFF", "DONATE", "RECYCLE", "CITY_PICKUP", "HAUL"]
Size = Literal["S", "M", "L", "XL"]
TaskStatus = Literal["todo", "in_progress", "waiting_for_user", "done", "skipped"]
StepState = Literal["planned", "running", "waiting_for_user", "done", "failed"]
MoveMethod = Literal["movers", "diy_truck", "shipping", "suitcases"]

# ---------- auth / move ----------


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class Priorities(BaseModel):
    cash: int = Field(default=50, ge=0, le=100)
    speed: int = Field(default=50, ge=0, le=100)
    landfill: int = Field(default=50, ge=0, le=100)


class GeoPoint(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: list[float]  # [lng, lat]


class MoveIn(BaseModel):
    move_date: str  # YYYY-MM-DD
    from_address: str = Field(min_length=2)
    to_address: str = Field(min_length=2)
    home_size: str = "1br"
    move_method: MoveMethod = "movers"
    priorities: Priorities = Priorities()
    relocation_budget: float = Field(default=2500, ge=0)
    work_address: str | None = None
    notice_period_days: int = Field(default=30, ge=0, le=120)
    from_geo: GeoPoint | None = None
    to_geo: GeoPoint | None = None
    work_geo: GeoPoint | None = None


class MovePatch(BaseModel):
    move_date: str | None = None
    from_address: str | None = None
    to_address: str | None = None
    home_size: str | None = None
    move_method: MoveMethod | None = None
    priorities: Priorities | None = None
    relocation_budget: float | None = None
    work_address: str | None = None
    notice_period_days: int | None = None
    onboarded: bool | None = None


# ---------- items ----------


class ItemPatch(BaseModel):
    name: str | None = None
    category: str | None = None
    brand_guess: str | None = None
    condition: int | None = Field(default=None, ge=1, le=5)
    size: Size | None = None
    dims_estimate: str | None = None
    resale_low: float | None = None
    resale_high: float | None = None
    move_cost_estimate: float | None = None
    replacement_cost_estimate: float | None = None
    decision: Decision | None = None
    decision_reason: str | None = None
    room_id: str | None = None
    status: str | None = None


# AI output schema for vision inventory
class VisionItem(BaseModel):
    name: str
    category: str
    brand_guess: str | None = None
    condition: int = Field(ge=1, le=5)
    size: Size
    dims_estimate: str
    resale_low: float = Field(ge=0)
    resale_high: float = Field(ge=0)
    move_cost_estimate: float = Field(ge=0)
    replacement_cost_estimate: float = Field(ge=0)
    weight_lbs: float = Field(default=20, ge=0)
    confidence: float = Field(default=0.7, ge=0, le=1)

    @field_validator("resale_high")
    @classmethod
    def _high_ge_low(cls, v: float, info):  # noqa: ANN001
        low = info.data.get("resale_low", 0)
        return max(v, low)


class VisionResult(BaseModel):
    items: list[VisionItem]


class DecisionOut(BaseModel):
    decision: Decision
    reason: str = Field(max_length=160)


# ---------- quotes ----------


class ParsedQuote(BaseModel):
    is_quote: bool
    price: float | None = None
    eta: str | None = None
    notes: str | None = None
    declined: bool = False


# ---------- documents ----------


class LeaseFlag(BaseModel):
    clause: str
    category: Literal["fees", "notice_period", "renewal", "deposit", "unusual", "pets", "other"]
    severity: Literal["low", "medium", "high"]
    explanation: str


class LeaseSummary(BaseModel):
    summary: list[str]
    rent: str | None = None
    term: str | None = None
    deposit: str | None = None
    notice_period: str | None = None
    flags: list[LeaseFlag]
    questions: list[str]


class Letter(BaseModel):
    subject: str
    body: str


class CarEstimate(BaseModel):
    make: str
    model: str
    year: int
    mileage: int | None = None
    value_low: float
    value_high: float
    confidence: float = 0.5


# ---------- runs / steps ----------


class ActionPatch(BaseModel):
    title: str | None = None
    enabled: bool | None = None
    params: dict | None = None


class TaskPatch(BaseModel):
    status: TaskStatus | None = None
    due_date: str | None = None
    title: str | None = None


class NeedIn(BaseModel):
    arrival_name: str = Field(min_length=1, max_length=60)
    contact: str | None = Field(default=None, max_length=120)
    city: str = "San Francisco"
    item_wanted: str = Field(min_length=2, max_length=120)
    details: str = Field(default="", max_length=500)
    needed_by: str | None = None
    neighborhood: str | None = None


class InterestIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    contact: str = Field(min_length=3, max_length=120)
    proposed_time: str = Field(min_length=2, max_length=120)
    message: str | None = Field(default=None, max_length=500)


class JobIn(BaseModel):
    type: Literal["haul", "mover", "auto_transport"] = "haul"
    item_ids: list[str] | None = None
    floor: int = 2
    elevator: bool = False
    time_window: str | None = None
