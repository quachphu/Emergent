"""Seed the demo: `python seed.py` (uses MONGO_URL / DB_NAME from backend/.env)."""

import asyncio

from core.db import ensure_indexes
from data.demo import DEMO_EMAIL, DEMO_PASSWORD, seed


async def main() -> None:
    await ensure_indexes()
    await seed()
    print(f"Demo seeded. Sign in as {DEMO_EMAIL} / {DEMO_PASSWORD} or use 'Try the demo'.")


if __name__ == "__main__":
    asyncio.run(main())
