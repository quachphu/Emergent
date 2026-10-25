"""Old home / new home actions: notice letter, lease summary, document extraction."""

from __future__ import annotations

import io
import logging

from core.db import get_db, insert, now
from core.events import publish

from . import paperwork, steps

log = logging.getLogger("handoff.home")


def extract_pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:  # noqa: BLE001
        log.warning("pdf extraction failed: %s", type(exc).__name__)
        return ""


async def draft_notice(move: dict, user: dict, *, run_id=None, action_id=None) -> dict:
    db = get_db()
    st = await steps.create_step(
        move["_id"],
        "old_home",
        "Draft your notice-to-vacate letter",
        state="running",
        run_id=run_id,
        action_id=action_id,
        reason="Uses your move date and notice period.",
        agent="paperwork",
    )
    letter, source = await paperwork.notice_letter(user, move)
    status = paperwork.notice_status(move)
    doc = await db.documents.find_one({"move_id": move["_id"], "type": "letter", "kind": "notice"})
    fields = {"title": letter.subject, "extracted_text": letter.body, "summary": status["message"], "flags": [], "source": source, "updated_at": now()}
    if doc:
        await db.documents.update_one({"_id": doc["_id"]}, {"$set": fields})
    else:
        doc = await insert("documents", {"move_id": move["_id"], "type": "letter", "kind": "notice", **fields})
    await steps.pace()
    await steps.finish(st, steps.receipt("document", f"Letter ready. {status['message']}", url="/old-home"))
    task = await db.tasks.find_one({"move_id": move["_id"], "key": "notice_to_vacate"})
    if task and task["status"] not in {"done", "skipped"}:
        await db.tasks.update_one({"_id": task["_id"]}, {"$set": {"status": "waiting_for_user"}})
    ws = await steps.create_step(
        move["_id"],
        "old_home",
        "Sign and send the notice yourself",
        state="waiting_for_user",
        run_id=run_id,
        action_id=action_id,
        task_id=task["_id"] if task else None,
        reason="Handoff never signs for you.",
        agent="paperwork",
    )
    await steps.update_step(ws["_id"], link="/old-home", cta="Open letter")
    publish(move["_id"], "document", {"id": doc["_id"]})
    return doc


async def summarize_document(move: dict, doc_id: str, *, run_id=None, action_id=None) -> dict:
    db = get_db()
    doc = await db.documents.find_one({"_id": doc_id, "move_id": move["_id"]})
    if not doc:
        raise ValueError("Document not found")
    st = await steps.create_step(
        move["_id"],
        "new_home",
        f"Read and summarize {doc.get('title') or 'your lease'}",
        state="running",
        run_id=run_id,
        action_id=action_id,
        reason=paperwork.LEGAL_NOTE,
        agent="paperwork",
    )
    text = doc.get("extracted_text") or ""
    summary, source = await paperwork.lease_summary(text)
    flags = [f.model_dump() for f in summary.flags]
    await db.documents.update_one(
        {"_id": doc_id}, {"$set": {"summary": summary.model_dump(), "flags": flags, "summarized_at": now(), "summary_source": source}}
    )
    high = sum(1 for f in flags if f["severity"] == "high")
    await steps.finish(
        st,
        steps.receipt(
            "document", f"{len(flags)} clauses flagged ({high} high). {len(summary.questions)} questions to ask. {paperwork.LEGAL_NOTE}", url="/new-home"
        ),
    )
    await db.tasks.update_one({"move_id": move["_id"], "key": "review_lease"}, {"$set": {"status": "done"}})
    publish(move["_id"], "document", {"id": doc_id})
    return await db.documents.find_one({"_id": doc_id})
