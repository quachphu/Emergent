from fastapi import APIRouter, Depends, HTTPException

from core.db import get_db, insert, to_json
from core.deps import current_user
from core.security import create_token, hash_password, verify_password
from models.schemas import LoginIn, SignupIn

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup")
async def signup(body: SignupIn):
    db = get_db()
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    user = await insert("users", {"name": body.name.strip(), "email": email, "password_hash": hash_password(body.password)})
    return {"token": create_token(user["_id"]), "user": to_json(user)}


@router.post("/login")
async def login(body: LoginIn):
    user = await get_db().users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Email or password is incorrect.")
    return {"token": create_token(user["_id"]), "user": to_json(user)}


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    move = await get_db().moves.find_one({"user_id": user["_id"]}, sort=[("created_at", -1)])
    return {"user": to_json(user), "has_move": bool(move), "move_id": move["_id"] if move else None}
