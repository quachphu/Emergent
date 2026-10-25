from fastapi import APIRouter, HTTPException

from core.config import get_settings
from core.db import to_json
from core.security import create_token
from data.demo import DEMO_EMAIL, seed

router = APIRouter(tags=["demo"])


@router.post("/demo/reset")
async def reset_demo():
    """Restore Maya's demo move and sign in as her. Only available in DEMO_MODE."""
    if not get_settings().demo_mode:
        raise HTTPException(404, "Demo mode is off.")
    user = await seed()
    return {"token": create_token(user["_id"]), "user": to_json(user), "email": DEMO_EMAIL}
