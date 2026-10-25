import os

os.environ.update(
    {
        "MONGO_URL": "mongomock://test",
        "DB_NAME": "handoff_test",
        "STEP_DELAY": "0",
        "SIM_REPLY_MIN": "0",
        "SIM_REPLY_MAX": "0.01",
        "LLM_PROVIDER": "mock",
        "MONGODB_AI_API_KEY": "",
        "STRIPE_SECRET_KEY": "",
        "STRIPE_WEBHOOK_SECRET": "whsec_test_secret",
        "TWILIO_ACCOUNT_SID": "",
        "MAPBOX_TOKEN": "",
        "DEMO_MODE": "true",
        "JWT_SECRET": "test-secret",
    }
)

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from core.config import reset_settings  # noqa: E402
from core.db import reset_db  # noqa: E402

reset_settings()


@pytest.fixture(autouse=True)
async def fresh_db():
    reset_settings()
    db = reset_db()
    yield db


@pytest.fixture
async def client():
    from server import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def demo(client):
    r = await client.post("/api/demo/reset")
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return {"client": client, "token": token}
