"""Relay LLM proxy — the ONE place a customer's OpenAI key lives.

Customer hubs never hold an OpenAI key. Their chat / intent-parse / automation-
design LLM calls go through the OpenAI SDK pointed at this relay endpoint, signed
per-request with the per-home `relay_secret` (X-Ziggy-Signature, same HMAC scheme
as telemetry/OTA). The relay verifies the signature, checks the home's
subscription, then forwards the request body VERBATIM to OpenAI with the
relay-held OPENAI_API_KEY (a Fly secret), streaming the response back.

Because the endpoint mirrors OpenAI's /v1/chat/completions shape, the hub SDK
needs no special code — only a base_url + a signing auth hook.

STT (Whisper) is deliberately NOT proxied — it stays local (DECISIONS.md).
"""
from __future__ import annotations

import json as _json
import os

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from ..audit import log_event, verify as verify_signature
from ..billing import is_subscription_active
from ..database import get_db
from .ota import _client_ip, _resolve_home_id_from_device_id

router = APIRouter()

_OPENAI_BASE = os.getenv("OPENAI_PROXY_BASE_URL", "https://api.openai.com")
# Chat + tools payloads are small; this cap blocks abuse without clipping real use.
MAX_LLM_BYTES = 512 * 1024

# Dedicated client — LLM calls (especially with tools) are slow, so allow a long
# read timeout. Closed on app shutdown (see main.py).
_openai_client = httpx.AsyncClient(
    base_url=_OPENAI_BASE,
    timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0),
    limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
)


async def _authorize(device_id: str, raw: bytes, sig_header: str, src_ip: str) -> str:
    """Verify HMAC + subscription; return home_id or raise."""
    home_id = _resolve_home_id_from_device_id(device_id)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT status, subscription_state, relay_secret FROM homes WHERE id=?",
            (home_id,),
        )
    if not rows:
        await log_event("llm_proxied", home_id=home_id, source_ip=src_ip, ok=False, detail="unknown_home_id")
        raise HTTPException(404, "Home not provisioned.")
    home = rows[0]
    ok, reason = verify_signature(home["relay_secret"], raw, sig_header)
    if not ok:
        await log_event("llm_proxied", home_id=home_id, source_ip=src_ip, ok=False, detail=f"signature: {reason}")
        raise HTTPException(401, "Invalid signature.")
    if not is_subscription_active(home_status=home["status"], subscription_state=home["subscription_state"]):
        await log_event("llm_proxied", home_id=home_id, source_ip=src_ip, ok=False, detail="subscription_inactive")
        raise HTTPException(402, "Cloud chat requires an active subscription.")
    return home_id


@router.post("/api/devices/{device_id}/llm/v1/chat/completions")
async def proxy_chat_completions(device_id: str, request: Request):
    raw = await request.body()
    src_ip = _client_ip(request)
    sig = request.headers.get("X-Ziggy-Signature", "")

    if len(raw) > MAX_LLM_BYTES:
        raise HTTPException(413, "Payload too large.")

    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        # Misconfigured relay — never happens in a properly-sealed deploy.
        raise HTTPException(503, "LLM proxy not configured.")

    home_id = await _authorize(device_id, raw, sig, src_ip)

    try:
        streaming = bool(_json.loads(raw or b"{}").get("stream"))
    except Exception:
        streaming = False

    fwd_headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    if streaming:
        async def _relay_stream():
            async with _openai_client.stream(
                "POST", "/v1/chat/completions", content=raw, headers=fwd_headers,
            ) as upstream:
                async for chunk in upstream.aiter_raw():
                    yield chunk
        await log_event("llm_proxied", home_id=home_id, source_ip=src_ip, ok=True, detail="stream")
        return StreamingResponse(_relay_stream(), media_type="text/event-stream")

    try:
        r = await _openai_client.post("/v1/chat/completions", content=raw, headers=fwd_headers)
    except httpx.TimeoutException:
        await log_event("llm_proxied", home_id=home_id, source_ip=src_ip, ok=False, detail="upstream_timeout")
        raise HTTPException(504, "LLM upstream timed out.")
    except httpx.HTTPError as e:
        await log_event("llm_proxied", home_id=home_id, source_ip=src_ip, ok=False, detail=f"upstream_error:{type(e).__name__}")
        raise HTTPException(502, "LLM upstream error.")

    await log_event("llm_proxied", home_id=home_id, source_ip=src_ip,
                    ok=(r.status_code < 400), detail=f"status={r.status_code}")
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type=r.headers.get("content-type", "application/json"),
    )
