"""Store uploaded images and PDFs in MongoDB (downscaled), served from /api/files/{id}."""

from __future__ import annotations

import base64
import io
import logging

from PIL import Image, ImageOps

from .db import get_db, new_id, now

log = logging.getLogger("handoff.files")

MAX_SIDE = 1280
MAX_BYTES = 12 * 1024 * 1024


def normalize_image(raw: bytes, max_side: int = MAX_SIDE) -> tuple[bytes, str]:
    """Return (jpeg_bytes, content_type). Raises ValueError for non-images."""
    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Not a readable image") from exc
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg.paste(img, mask=img.split()[-1])
        else:
            bg.paste(img.convert("RGB"))
        img = bg
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=84, optimize=True)
    return out.getvalue(), "image/jpeg"


async def store_file(
    data: bytes,
    content_type: str,
    *,
    move_id: str | None = None,
    name: str = "",
    kind: str = "file",
    public: bool = False,
) -> dict:
    if len(data) > MAX_BYTES:
        raise ValueError("File too large (12 MB max)")
    doc = {
        "_id": new_id(),
        "move_id": move_id,
        "name": name,
        "kind": kind,
        "content_type": content_type,
        "size": len(data),
        "data": data,
        "public": public,
        "created_at": now(),
    }
    await get_db().files.insert_one(doc)
    return doc


async def store_image(raw: bytes, **kw) -> dict:
    data, ctype = normalize_image(raw)
    return await store_file(data, ctype, **kw)


async def load_file(file_id: str) -> dict | None:
    return await get_db().files.find_one({"_id": file_id})


async def file_b64(file_id: str) -> tuple[str, str] | None:
    doc = await load_file(file_id)
    if not doc:
        return None
    return base64.b64encode(bytes(doc["data"])).decode("ascii"), doc["content_type"]


def file_url(file_id: str | None) -> str | None:
    return f"/api/files/{file_id}" if file_id else None
