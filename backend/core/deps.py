"""FastAPI dependencies: current user and current move."""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Query

from .db import get_db
from .security import decode_token


async def _user_from_token(token: str | None) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    user_id = decode_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.")
    user = await get_db().users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Account not found.")
    return user


async def current_user(authorization: str | None = Header(default=None)) -> dict:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    return await _user_from_token(token)


async def current_user_query(token: str | None = Query(default=None)) -> dict:
    """For EventSource (SSE), which cannot set headers."""
    return await _user_from_token(token)


async def move_for_user(user: dict) -> dict:
    move = await get_db().moves.find_one({"user_id": user["_id"]}, sort=[("created_at", -1)])
    if not move:
        raise HTTPException(status_code=404, detail="No move yet. Finish setup first.")
    return move


async def current_move(user: dict = Depends(current_user)) -> dict:
    return await move_for_user(user)
