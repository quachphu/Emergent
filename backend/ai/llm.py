"""One provider module for every model call.

    vision_json(images, schema, prompt, fallback=...)
    text_json(schema, prompt, fallback=...)

Both return an instance of `schema` (a Pydantic model). The provider is chosen by LLM_PROVIDER:
  - anthropic: Claude via ANTHROPIC_API_KEY (structured outputs + Pydantic validation)
  - emergent:  Emergent Universal LLM Key via `emergentintegrations` (installed on Emergent)
  - mock:      no model; the caller's deterministic `fallback` is used
Invalid JSON is retried once. If the model is unavailable or still invalid, the `fallback`
callable produces the answer so the product keeps working; the source is reported in `.source`.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ValidationError

from core.config import get_settings

log = logging.getLogger("handoff.llm")

T = TypeVar("T", bound=BaseModel)

SYSTEM = (
    "You are Handoff, an AI relocation assistant. Answer only with JSON that matches the schema. "
    "Money values are USD estimates based on similar items. Never invent personal identifiers."
)


@dataclass
class Image:
    data_b64: str
    media_type: str = "image/jpeg"
    name: str = ""


@dataclass
class LLMResult(Generic[T]):
    value: T
    source: str  # "anthropic" | "emergent" | "fallback"


Fallback = Callable[[], "T | Awaitable[T]"]

# After a connection/auth failure, skip the provider for a while so the UI isn't slowed down.
_down_until: float = 0.0


def provider_status() -> dict:
    s = get_settings()
    live = s.llm_provider in {"anthropic", "emergent"} and time.time() >= _down_until
    return {"provider": s.llm_provider, "live": live, "model": s.anthropic_model if s.llm_provider == "anthropic" else None}


def _extract_json(text: str) -> Any:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


async def _anthropic_call(schema: type[T], prompt: str, images: list[Image], effort: str) -> T:
    import anthropic

    s = get_settings()
    client = anthropic.AsyncAnthropic(api_key=s.anthropic_api_key, max_retries=1, timeout=60.0)
    content: list[dict] = [{"type": "image", "source": {"type": "base64", "media_type": im.media_type, "data": im.data_b64}} for im in images]
    content.append({"type": "text", "text": prompt})
    response = await client.messages.parse(
        model=s.anthropic_model,
        max_tokens=8000,
        system=SYSTEM,
        output_config={"effort": effort},
        output_format=schema,
        messages=[{"role": "user", "content": content}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("model declined the request")
    parsed = getattr(response, "parsed_output", None)
    if parsed is not None:
        return parsed
    text = next((b.text for b in response.content if b.type == "text"), "")
    return schema.model_validate(_extract_json(text))


async def _emergent_call(schema: type[T], prompt: str, images: list[Image], effort: str) -> T:
    # Only available inside Emergent (`pip install emergentintegrations --extra-index-url ...`).
    from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage  # type: ignore

    s = get_settings()
    chat = LlmChat(
        api_key=s.emergent_llm_key,
        session_id=f"handoff-{int(time.time() * 1000)}",
        system_message=SYSTEM + " JSON schema: " + json.dumps(schema.model_json_schema()),
    ).with_model("anthropic", s.anthropic_model)
    msg = UserMessage(
        text=prompt + "\nRespond with JSON only.",
        file_contents=[ImageContent(image_base64=im.data_b64) for im in images] or None,
    )
    text = await chat.send_message(msg)
    return schema.model_validate(_extract_json(str(text)))


async def _run_fallback(fallback: Fallback) -> Any:
    value = fallback()
    if hasattr(value, "__await__"):
        value = await value  # type: ignore[misc]
    return value


async def _call(schema: type[T], prompt: str, images: list[Image], fallback: Fallback, effort: str) -> LLMResult[T]:
    global _down_until
    s = get_settings()
    provider = s.llm_provider
    if provider not in {"anthropic", "emergent"} or time.time() < _down_until:
        return LLMResult(await _run_fallback(fallback), "fallback")

    fn = _anthropic_call if provider == "anthropic" else _emergent_call
    attempt_prompt = prompt
    for attempt in range(2):  # retry once on invalid JSON
        try:
            value = await fn(schema, attempt_prompt, images, effort)
            return LLMResult(value, provider)
        except (ValidationError, json.JSONDecodeError, ValueError) as exc:
            log.warning("llm invalid json (attempt %d): %s", attempt + 1, type(exc).__name__)
            attempt_prompt = prompt + "\n\nYour previous answer did not match the schema. Return only valid JSON for the schema."
        except ImportError:
            log.warning("llm provider %s not installed; using fallback", provider)
            _down_until = time.time() + 600
            break
        except Exception as exc:  # network, auth, refusal, rate limit
            log.warning("llm call failed (%s); using fallback", type(exc).__name__)
            _down_until = time.time() + 60
            break
    return LLMResult(await _run_fallback(fallback), "fallback")


async def vision_json(images: list[Image], schema: type[T], prompt: str, *, fallback: Fallback, effort: str = "medium") -> LLMResult[T]:
    return await _call(schema, prompt, images, fallback, effort)


async def text_json(schema: type[T], prompt: str, *, fallback: Fallback, effort: str = "low") -> LLMResult[T]:
    return await _call(schema, prompt, [], fallback, effort)
