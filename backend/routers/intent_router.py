from __future__ import annotations

import os
import tempfile
import time
import uuid
from collections import deque
from threading import Lock
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from backend.ws_manager import manager
from core.action_parser import handle_intent
from core.intent_parser import quick_parse
from core.logger_module import log_error, log_info
from core.result_utils import render_result
from core.debug_bus import bus, BASIC, VERBOSE, TRACE

router = APIRouter()

# /api/voice rate limit + size guard. In-memory sliding window per client key.
# Each /api/voice call typically hits OpenAI Whisper, so cap usage to keep both
# accidental loops and compromised cookies from running up cost.
_VOICE_MAX_UPLOAD_BYTES = 5 * 1024 * 1024   # 5 MB
_VOICE_RATE_WINDOW_S    = 60
_VOICE_RATE_MAX         = 30                # 30 /min/client
_VOICE_ALLOWED_TYPES    = {"audio/wav", "audio/x-wav", "audio/wave",
                           "audio/webm", "audio/ogg", "audio/mpeg",
                           "application/octet-stream"}

_voice_hits: dict[str, deque[float]] = {}
_voice_hits_lock = Lock()


def _voice_client_key(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        ident = user.get("username") or user.get("user_id")
        if ident:
            return f"u:{ident}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


def _voice_rate_check(request: Request) -> None:
    key = _voice_client_key(request)
    now = time.time()
    cutoff = now - _VOICE_RATE_WINDOW_S
    with _voice_hits_lock:
        dq = _voice_hits.setdefault(key, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _VOICE_RATE_MAX:
            retry_after = max(1, int(dq[0] + _VOICE_RATE_WINDOW_S - now))
            raise HTTPException(
                status_code=429,
                detail=f"Voice rate limit ({_VOICE_RATE_MAX}/min) exceeded. Retry in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        dq.append(now)

# Intents that should bypass direct execution in chat mode and go through
# handle_chat_with_gpt (session history + autonomous web search) instead.
_GPT_FALLBACK_INTENTS = frozenset({
    "unrecognized_command",
    "ziggy_chat",
    "web_search_summary",
    "web_news_brief",
    "web_recipe_read",
    "web_trip_updates",
    "web_stocks_update",
})


def _new_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:10]}"


class IntentRequest(BaseModel):
    text: str
    source: str = "web"


class ChatRequest(BaseModel):
    text: str
    chat_history: list[dict[str, Any]] = []
    source: str = "web"


class DirectIntentRequest(BaseModel):
    intent: str
    params: dict = {}
    source: str = "web"


@router.post("/api/intent")
async def process_intent(req: IntentRequest):
    request_id = _new_request_id()

    bus.emit("intent", BASIC, "request_received",
             request_id=request_id,
             input=req.text,
             source=req.source,
             endpoint="/api/intent")

    intent_data = quick_parse(req.text)
    intent_data["source"] = req.source
    intent_data["request_id"] = request_id
    intent_data["_raw_input"] = req.text

    bus.emit("intent", VERBOSE, "intent_parsed",
             request_id=request_id,
             intent=intent_data.get("intent"),
             params=intent_data.get("params", {}),
             parse_source=intent_data.get("source"))

    result = await handle_intent(intent_data)
    reply = render_result(result)

    top_intent = intent_data.get("intent")
    broadcast_intent = top_intent
    if top_intent == "__multi__":
        sub = (intent_data.get("intents") or [{}])[0]
        broadcast_intent = f"__multi__({sub.get('intent', '?')}+)"

    await manager.broadcast({
        "type": "ziggy_response",
        "input": req.text,
        "reply": reply,
        "source": req.source,
        "ok": result.get("ok", True),
        "intent": broadcast_intent,
        "params": intent_data.get("params", {}),
        "request_id": request_id,
    })

    return {
        "reply": reply,
        "ok": result.get("ok", True),
        "intent": broadcast_intent,
        "params": intent_data.get("params", {}),
        "data": result.get("data", {}),
        "request_id": request_id,
    }


@router.post("/api/chat")
async def process_chat(req: ChatRequest):
    request_id = _new_request_id()

    bus.emit("intent", BASIC, "request_received",
             request_id=request_id,
             input=req.text,
             source=req.source,
             endpoint="/api/chat")

    parsed = quick_parse(req.text, chat_history=req.chat_history)
    parsed["source"] = req.source
    parsed["request_id"] = request_id
    parsed["_raw_input"] = req.text

    top_intent = parsed.get("intent")

    bus.emit("intent", VERBOSE, "intent_parsed",
             request_id=request_id,
             intent=top_intent,
             params=parsed.get("params", {}),
             gpt_fallback=(top_intent in _GPT_FALLBACK_INTENTS and top_intent != "__multi__"))

    if top_intent not in _GPT_FALLBACK_INTENTS or top_intent == "__multi__":
        result = await handle_intent(parsed)
    else:
        result = await handle_intent({
            "intent": "chat_with_gpt",
            "params": {"text": req.text, "chat_history": req.chat_history},
            "source": req.source,
            "request_id": request_id,
        })

    reply = render_result(result)

    # Translate action responses to Hebrew when the user typed in Hebrew.
    # chat_with_gpt already responds in Hebrew natively; this covers command
    # intents (toggle_light, control_ac, etc.) and multi-intent combinations
    # whose handlers return English strings.
    #
    # The old gate was `not is_hebrew(reply)` — but is_hebrew returns True if
    # ANY Hebrew char appears, so a mostly-English multi-intent reply like
    # "Turning off living room light and Task added: לקנות חלב" was treated
    # as Hebrew (because of the embedded task title) and translation was
    # skipped. Switch to a Latin-vs-Hebrew letter ratio: if Latin letters
    # outweigh Hebrew letters, the connective prose is English and we should
    # translate.
    if top_intent not in _GPT_FALLBACK_INTENTS:
        from interfaces.voice_interface import _translate, is_hebrew as _is_hebrew
        if _is_hebrew(req.text) and reply:
            hebrew_letters = sum(1 for c in reply if 'א' <= c <= 'ת')
            latin_letters = sum(1 for c in reply if 'a' <= c.lower() <= 'z')
            if latin_letters > hebrew_letters:
                try:
                    reply = _translate(reply)
                except Exception:
                    pass

    broadcast_intent = top_intent
    if top_intent == "__multi__":
        sub = (parsed.get("intents") or [{}])[0]
        broadcast_intent = f"__multi__({sub.get('intent', '?')}+)"

    await manager.broadcast({
        "type": "ziggy_response",
        "input": req.text,
        "reply": reply,
        "source": req.source,
        "ok": result.get("ok", True),
        "intent": broadcast_intent,
        "request_id": request_id,
    })

    return {
        "reply": reply,
        "ok": result.get("ok", True),
        "data": result.get("data", {}),
        "request_id": request_id,
    }


def _validate_voice_upload(file: UploadFile, request_id: str) -> tuple[str, str]:
    """Shared content-type validation. Returns (temp file suffix, normalised ctype)."""
    ctype = (file.content_type or "").split(";", 1)[0].strip().lower()
    if ctype and ctype not in _VOICE_ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported audio content-type: {ctype}")
    suffix = ".wav" if "wav" in ctype else ".webm"
    return suffix, ctype


async def _write_voice_tmpfile(file: UploadFile, suffix: str) -> tuple[str, int]:
    """Read upload into a temp file, enforcing the size cap."""
    data = await file.read()
    if len(data) > _VOICE_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio upload too large ({len(data)} > {_VOICE_MAX_UPLOAD_BYTES} bytes).",
        )
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        return tmp.name, len(data)


def _emit_transcript_events(request_id: str, transcription: str, lang: str) -> None:
    """Privacy: at VERBOSE expose only metadata; raw transcripts gated to TRACE."""
    bus.emit("voice", VERBOSE, "voice_transcribed",
             request_id=request_id,
             length=len(transcription),
             language=lang,
             empty=not transcription.strip())
    bus.emit("voice", TRACE, "voice_transcribed_full",
             request_id=request_id,
             transcription=transcription,
             language=lang)


@router.post("/api/voice/transcribe")
async def transcribe_voice(request: Request, file: UploadFile = File(...)):
    """Transcribe audio to text. No intent handling, no reply generation.

    The chat UI uses this for hold-to-talk so the user's words can be shown on
    screen the moment Whisper returns — before the (slower) chat reply pipeline
    runs. The frontend follows this with a regular POST /api/chat using the
    returned transcription.
    """
    _voice_rate_check(request)
    request_id = _new_request_id()
    suffix, ctype = _validate_voice_upload(file, request_id)
    tmp_path = None
    try:
        tmp_path, byte_len = await _write_voice_tmpfile(file, suffix)
        bus.emit("voice", BASIC, "voice_received",
                 request_id=request_id, content_type=ctype, bytes=byte_len,
                 endpoint="/api/voice/transcribe")

        from interfaces.voice_interface import transcribe_web
        transcription, lang = transcribe_web(tmp_path)
        _emit_transcript_events(request_id, transcription, lang)

        return {
            "transcription": transcription,
            "lang": lang,
            "ok": bool(transcription.strip()),
            "request_id": request_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[API] Voice transcribe error: {e}")
        bus.emit("voice", BASIC, "voice_error",
                 request_id=request_id, error=str(e),
                 error_type=type(e).__name__, result="exception")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try: os.unlink(tmp_path)
            except Exception: pass


@router.post("/api/voice")
async def process_voice(request: Request, file: UploadFile = File(...)):
    _voice_rate_check(request)
    request_id = _new_request_id()

    ctype = (file.content_type or "").split(";", 1)[0].strip().lower()
    if ctype and ctype not in _VOICE_ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported audio content-type: {ctype}")

    suffix = ".wav" if "wav" in ctype else ".webm"
    tmp_path = None
    try:
        data = await file.read()
        if len(data) > _VOICE_MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Audio upload too large ({len(data)} > {_VOICE_MAX_UPLOAD_BYTES} bytes).",
            )
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        bus.emit("voice", BASIC, "voice_received",
                 request_id=request_id,
                 content_type=ctype,
                 bytes=len(data))

        from interfaces.voice_interface import _translate, transcribe_web
        transcription, lang = transcribe_web(tmp_path)

        # Privacy: at VERBOSE, expose only metadata. Raw transcripts go out at TRACE
        # only — debug.level must be explicitly raised to TRACE to see them.
        bus.emit("voice", VERBOSE, "voice_transcribed",
                 request_id=request_id,
                 length=len(transcription),
                 language=lang,
                 empty=not transcription.strip())
        bus.emit("voice", TRACE, "voice_transcribed_full",
                 request_id=request_id,
                 transcription=transcription,
                 language=lang)

        if not transcription.strip():
            return {"reply": "", "transcription": "", "ok": False, "error": "No speech detected"}

        intent_data = quick_parse(transcription)
        intent_data["source"] = "web_voice"
        intent_data["request_id"] = request_id
        intent_data["_raw_input"] = transcription
        result = await handle_intent(intent_data)
        reply = render_result(result)

        if lang == "he":
            reply = _translate(reply)

        await manager.broadcast({
            "type": "ziggy_response",
            "input": transcription,
            "reply": reply,
            "source": "web_voice",
            "ok": result.get("ok", True),
            "request_id": request_id,
        })

        return {"transcription": transcription, "reply": reply, "lang": lang,
                "ok": result.get("ok", True), "request_id": request_id}

    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[API] Voice error: {e}")
        bus.emit("voice", BASIC, "voice_error",
                 request_id=request_id,
                 error=str(e),
                 error_type=type(e).__name__,
                 result="exception")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@router.post("/api/direct-intent")
async def process_direct_intent(req: DirectIntentRequest):
    request_id = _new_request_id()
    intent_data = {
        "intent": req.intent,
        "params": req.params,
        "source": req.source,
        "request_id": request_id,
    }
    bus.emit("intent", BASIC, "request_received",
             request_id=request_id,
             intent=req.intent,
             source=req.source,
             endpoint="/api/direct-intent")

    result = await handle_intent(intent_data)
    reply = render_result(result)
    await manager.broadcast({
        "type": "ziggy_response",
        "reply": reply,
        "source": req.source,
        "ok": result.get("ok", True),
        "intent": req.intent,
        "params": req.params,
        "request_id": request_id,
    })
    return {
        "reply": reply,
        "ok": result.get("ok", True),
        "intent": req.intent,
        "params": req.params,
        "request_id": request_id,
    }
