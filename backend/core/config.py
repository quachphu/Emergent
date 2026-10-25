"""Settings read from environment variables. Never log secret values."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    def __init__(self) -> None:
        env = os.environ.get
        self.mongo_url: str = env("MONGO_URL", "mongomock://local")
        self.db_name: str = env("DB_NAME", "handoff")
        self.cors_origins: list[str] = [o.strip() for o in env("CORS_ORIGINS", "*").split(",") if o.strip()]
        self.jwt_secret: str = env("JWT_SECRET") or "dev-insecure-secret"
        self.frontend_url: str = (env("FRONTEND_URL") or "http://localhost:3000").rstrip("/")
        self.demo_mode: bool = _bool("DEMO_MODE", True)
        # Seconds between visible agent steps (0 in tests).
        self.step_delay: float = float(env("STEP_DELAY", "0.9"))
        # Seconds range for simulated vendor replies.
        self.sim_reply_min: float = float(env("SIM_REPLY_MIN", "5"))
        self.sim_reply_max: float = float(env("SIM_REPLY_MAX", "20"))

        self.anthropic_api_key: str = env("ANTHROPIC_API_KEY", "")
        self.anthropic_model: str = env("ANTHROPIC_MODEL", "claude-opus-5-5")
        self.emergent_llm_key: str = env("EMERGENT_LLM_KEY", "")
        provider = (env("LLM_PROVIDER") or "").strip().lower()
        if not provider:
            if self.anthropic_api_key:
                provider = "anthropic"
            elif self.emergent_llm_key:
                provider = "emergent"
            else:
                provider = "mock"
        self.llm_provider: str = provider

        self.mongodb_ai_api_key: str = env("MONGODB_AI_API_KEY", "")
        self.mongodb_ai_endpoint: str = env("MONGODB_AI_ENDPOINT", "https://ai.mongodb.com/v1/embeddings")
        self.embedding_model: str = env("EMBEDDING_MODEL", "voyage-4-lite")

        self.stripe_secret_key: str = env("STRIPE_SECRET_KEY", "")
        self.stripe_publishable_key: str = env("STRIPE_PUBLISHABLE_KEY", "")
        self.stripe_webhook_secret: str = env("STRIPE_WEBHOOK_SECRET", "")

        self.twilio_sid: str = env("TWILIO_ACCOUNT_SID", "")
        self.twilio_token: str = env("TWILIO_AUTH_TOKEN", "")
        self.twilio_from: str = env("TWILIO_FROM_NUMBER", "")

        self.mapbox_token: str = env("MAPBOX_TOKEN", "")

    @property
    def twilio_enabled(self) -> bool:
        return bool(self.twilio_sid and self.twilio_token and self.twilio_from)

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_secret_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()
