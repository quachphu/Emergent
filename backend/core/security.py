"""Password hashing (bcrypt) and JWT tokens."""

from __future__ import annotations

from datetime import timedelta

import bcrypt
import jwt

from .config import get_settings
from .db import now

ALGO = "HS256"
TOKEN_DAYS = 14


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except ValueError:
        return False


def create_token(user_id: str, *, purpose: str = "session", days: int = TOKEN_DAYS) -> str:
    payload = {"sub": user_id, "purpose": purpose, "exp": now() + timedelta(days=days)}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm=ALGO)


def decode_token(token: str, *, purpose: str = "session") -> str | None:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != purpose:
        return None
    return payload.get("sub")
