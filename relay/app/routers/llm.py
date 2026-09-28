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

# USD per 1M tokens: (input, cached input, output). What a home's chat costs the company is
# computed here, at the one place every call passes through. A model not in the table is
# priced at the default and the row says so (estimated=1), so a total is never silently
# short — it is loud about what it guessed.
PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-5.5": (4.0, 0.4, 20.0),
    "gpt-5.6-sol": (4.0, 0.4, 20.0), "gpt-5.6-terra": (2.0, 0.2, 12.0), "gpt-5.6-luna": (0.2, 0.02, 1.2),
    "gpt-4o": (2.5, 1.25, 10.0), "gpt-4o-mini": (0.15, 0.075, 0.6),
    "gpt-4.1": (2.0, 0.5, 8.0), "gpt-4.1-mini": (0.4, 0.1, 1.6), "gpt-4.1-nano": (0.1, 0.025, 0.4),
}
DEFAULT_PRICE = (4.0, 0.4, 20.0)


def price_of(model: str | None) -> tuple[tuple[float, float, float], bool]:
    """(prices, estimated). A dated snapshot name ('gpt-4o-2024-08-06') prices as its family."""
    m = (model or "").strip()
    if m in PRICES:
        return PRICES[m], False
    for name in sorted(PRICES, key=len, reverse=True):
        if m.startswith(name):
            return PRICES[name], False
    return DEFAULT_PRICE, True


def cost_usd(model: str | None, usage: dict) -> tuple[float, bool]:
    (pin, pcache, pout), est = price_of(model)
    cached = int(usage.get("cached_tokens") or 0)
    uncached = max(int(usage.get("input_tokens") or 0) - cached, 0)
    return (uncached * pin + cached * pcache + int(usage.get("output_tokens") or 0) * pout) / 1_000_000, est


def usage_from_completion(data: dict) -> dict | None:
    """The usage block of a chat completion (or the final chunk of a stream), normalised."""
    u = (data or {}).get("usage")
    if not isinstance(u, dict):
        return None
    details = u.get("prompt_tokens_details") or u.get("input_tokens_details") or {}
    return {"input_tokens": int(u.get("prompt_tokens") or u.get("input_tokens") or 0),
            "cached_tokens": int(details.get("cached_tokens") or 0),
            "output_tokens": int(u.get("completion_tokens") or u.get("output_tokens") or 0)}


async def record_usage(home_id: str, model: str | None, usage: dict | None, *, streamed: bool) -> None:
    """One row per forwarded call. Best-effort: accounting must never fail a chat."""
    if not usage:
        return
    try:
        usd, est = cost_usd(model, usage)
        from datetime import datetime, timezone
        async with get_db() as db:
            await db.execute(
                "INSERT INTO llm_usage (home_id, ts, model, input_tokens, cached_tokens, output_tokens, cost_usd, streamed, estimated) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (home_id, datetime.now(timezone.utc).isoformat(timespec="seconds"), model,
                 usage["input_tokens"], usage["cached_tokens"], usage["output_tokens"], round(usd, 6), int(streamed), int(est)))
            await db.commit()
    except Exception:  # noqa: BLE001 — a stats failure is not a chat failure
        pass


def usage_from_stream_tail(tail: bytes) -> tuple[str | None, dict | None]:
    """The last SSE chunk of a stream carries the usage when the request asked for it.
    Returns (model, usage) from the last data: line that has a usage block."""
    model, usage = None, None
    for line in tail.decode("utf-8", "ignore").splitlines():
        line = line.strip()
        if not line.startswith("data:") or line.endswith("[DONE]"):
            continue
        try:
            obj = _json.loads(line[5:].strip())
        except ValueError:
            continue
        u = usage_from_completion(obj)
        if u:
            usage = u
            model = obj.get("model") or model
        elif obj.get("model"):
            model = obj["model"]
    return model, usage


def with_stream_usage(raw: bytes) -> bytes:
    """A streaming request, asked to also send its usage in the final chunk. The hub's
    signature was verified over the original bytes; what we forward to OpenAI is ours."""
    try:
        body = _json.loads(raw or b"{}")
    except ValueError:
        return raw
    opts = body.get("stream_options") if isinstance(body.get("stream_options"), dict) else {}
    body["stream_options"] = {**opts, "include_usage": True}
    return _json.dumps(body).encode()

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
    try:
        req_model = _json.loads(raw or b"{}").get("model")
    except Exception:
        req_model = None

    if streaming:
        async def _relay_stream():
            tail = b""
            async with _openai_client.stream(
                "POST", "/v1/chat/completions", content=with_stream_usage(raw), headers=fwd_headers,
            ) as upstream:
                async for chunk in upstream.aiter_raw():
                    tail = (tail + chunk)[-16384:]
                    yield chunk
            model, usage = usage_from_stream_tail(tail)
            await record_usage(home_id, model or req_model, usage, streamed=True)
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
    if r.status_code < 400:
        try:
            data = r.json()
        except ValueError:
            data = {}
        await record_usage(home_id, (data or {}).get("model") or req_model, usage_from_completion(data), streamed=False)
    return Response(
        content=r.content,
        status_code=r.status_code,
        media_type=r.headers.get("content-type", "application/json"),
    )
