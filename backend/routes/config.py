from fastapi import APIRouter

from ai import embeddings, llm
from core.config import get_settings
from services import sms, stripe_service

router = APIRouter(tags=["config"])


@router.get("/health")
async def health():
    return {"ok": True}


@router.get("/config")
async def config():
    """Public configuration only: publishable keys and integration status. Never secret keys."""
    s = get_settings()
    return {
        "demo_mode": s.demo_mode,
        "mapbox_token": s.mapbox_token or None,
        "stripe_publishable_key": s.stripe_publishable_key or None,
        "frontend_url": s.frontend_url,
        "integrations": {
            "llm": llm.provider_status(),
            "embeddings": embeddings.status(),
            "stripe": stripe_service.status(),
            "sms": sms.status(),
            "maps": {"provider": "mapbox" if s.mapbox_token else "openstreetmap", "live": bool(s.mapbox_token)},
        },
    }
