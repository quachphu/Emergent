from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from core.files import load_file

router = APIRouter(tags=["files"])


@router.get("/files/{file_id}")
async def get_file(file_id: str):
    # File ids are unguessable 128-bit tokens; item photos must load on public listing pages.
    doc = await load_file(file_id)
    if not doc:
        raise HTTPException(404, "File not found")
    return Response(content=bytes(doc["data"]), media_type=doc["content_type"], headers={"Cache-Control": "private, max-age=86400"})
