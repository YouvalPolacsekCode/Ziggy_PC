from __future__ import annotations

import asyncio
import os
import re
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
    engine: str | None = None   # "v1" | "v2" — per-request override for A/B
    thread_id: str | None = None  # when set → durable, background, resumable thread


def _resolve_engine(override: str | None) -> str:
    """Which assistant engine handles this turn.

    Priority: per-request override > env ZIGGY_ASSISTANT_ENGINE > settings
    assistant.engine > "v1" (the working fallback). v2 is the single tool-calling
    agent (core.agent.runner); v1 is the legacy quick_parse + handlers path.
    """
    if override in ("v1", "v2"):
        return override
    env = os.getenv("ZIGGY_ASSISTANT_ENGINE")
    if env in ("v1", "v2"):
        return env
    try:
        from core.settings_loader import settings
        val = (settings.get("assistant") or {}).get("engine")
        if val in ("v1", "v2"):
            return val
    except Exception:
        pass
    return "v1"


# ── Phrase → routine shortcut ──────────────────────────────────────────────
# Before any engine handles the turn: if the user's text exactly matches an
# On-demand routine's name (normalized), run that routine deterministically.
# Makes "good night" (and any named routine) fire identically on v1/v2/voice —
# no LLM guesswork for a nightly command, and a future "Hey Ziggy good night"
# from a speaker (STT → text → here) rides the same path.

def _norm_phrase(s: str | None) -> str:
    # Keep word chars + Hebrew; collapse everything else to single spaces.
    return re.sub(r"[^\w֐-׿]+", " ", (s or "").lower()).strip()


async def _match_routine_phrase(text: str) -> dict | None:
    q = _norm_phrase(text)
    if not q:
        return None
    try:
        from services.ha_scripts import list_scripts
        routines = await asyncio.to_thread(list_scripts)
    except Exception:
        return None
    for r in (routines or []):
        if _norm_phrase(r.get("name")) == q:   # exact full match — no substrings
            return r
    return None


async def _run_routine_phrase(routine: dict, req_text: str, source: str, request_id: str) -> dict:
    from services.local_automation_actions import execute_ziggy_actions
    name = routine.get("name") or "Routine"
    ok = True
    try:
        await execute_ziggy_actions(routine["id"], name)
    except Exception as e:
        log_error(f"[chat] routine '{name}' run failed: {e}")
        ok = False
    reply = f"✓ {name}" if ok else f"Couldn't run {name}."
    bus.emit("intent", BASIC, "routine_phrase_run",
             request_id=request_id, routine=name, result="ok" if ok else "error")
    await manager.broadcast({
        "type": "ziggy_response", "input": req_text, "reply": reply,
        "source": source, "ok": ok, "request_id": request_id,
    })
    return {"reply": reply, "ok": ok, "data": {}, "request_id": request_id, "engine": "routine"}


class DirectIntentRequest(BaseModel):
    intent: str
    params: dict = {}
    source: str = "web"


def _actor_ref(request: Request | None) -> str | None:
    """Principal ref for the authenticated caller, for the permission platform.

    Additive: used only by shadow/enforce evaluation in the device handler.
    Returns None when no user is attached (unauthenticated/internal), which the
    permission layer treats as fail-open."""
    user = getattr(getattr(request, "state", None), "user", None)
    if isinstance(user, dict) and user.get("username"):
        return f"person:{user['username']}"
    return None


@router.post("/api/intent")
async def process_intent(req: IntentRequest, request: Request):
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
    # Thread the caller identity so the permission platform can attribute the
    # command (no-op unless features.permission_enforcement is enabled).
    _actor = _actor_ref(request)
    if _actor:
        intent_data.setdefault("params", {})["_actor"] = _actor

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


async def _compute_reply(text, chat_history, source, engine, actor, request_id) -> dict:
    """Run one turn through the engine (v2 agent or v1 dispatch) → {reply, ok, data, intent}.

    Extracted so the legacy synchronous /api/chat path AND the background thread runner
    share identical logic. Does NOT broadcast — callers announce ziggy_response as needed.
    """
    # ── v2 engine: single tool-calling agent (falls through to v1 if missing) ──
    if _resolve_engine(engine) == "v2":
        try:
            from core.agent.runner import run_agent
        except Exception as e:
            log_error(f"[chat] v2 engine requested but unavailable, using v1: {e}")
            run_agent = None
        if run_agent is not None:
            channel = "voice" if "voice" in (source or "") else "chat"
            result = await run_agent(text, chat_history, channel=channel)
            return {"reply": result.get("message", ""), "ok": result.get("ok", True),
                    "data": result.get("data", {}), "intent": None}

    parsed = quick_parse(text, chat_history=chat_history)
    parsed["source"] = source
    parsed["request_id"] = request_id
    parsed["_raw_input"] = text
    if actor:
        parsed.setdefault("params", {})["_actor"] = actor

    top_intent = parsed.get("intent")
    bus.emit("intent", VERBOSE, "intent_parsed",
             request_id=request_id, intent=top_intent,
             params=parsed.get("params", {}),
             gpt_fallback=(top_intent in _GPT_FALLBACK_INTENTS and top_intent != "__multi__"))

    if top_intent not in _GPT_FALLBACK_INTENTS or top_intent == "__multi__":
        result = await handle_intent(parsed)
    else:
        result = await handle_intent({
            "intent": "chat_with_gpt",
            "params": {"text": text, "chat_history": chat_history},
            "source": source, "request_id": request_id,
        })

    reply = render_result(result)

    # Translate English handler replies to Hebrew when the user typed Hebrew
    # (chat_with_gpt already answers in Hebrew; this covers command/multi intents).
    if top_intent not in _GPT_FALLBACK_INTENTS:
        from interfaces.voice_interface import _translate, is_hebrew as _is_hebrew
        if _is_hebrew(text) and reply:
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

    return {"reply": reply, "ok": result.get("ok", True),
            "data": result.get("data", {}), "intent": broadcast_intent}


async def _announce_ziggy_response(text, reply, source, ok, intent, request_id, data=None):
    """The legacy global ziggy_response broadcast (App.jsx keys automation side-effects off it)."""
    payload = {"type": "ziggy_response", "input": text, "reply": reply,
               "source": source, "ok": ok, "request_id": request_id}
    if intent is not None:
        payload["intent"] = intent
    if data:
        payload["data"] = data
    await manager.broadcast(payload)


@router.post("/api/chat")
async def process_chat(req: ChatRequest, request: Request):
    request_id = _new_request_id()
    actor = _actor_ref(request)

    bus.emit("intent", BASIC, "request_received",
             request_id=request_id, input=req.text, source=req.source, endpoint="/api/chat")

    # ── Phrase → routine shortcut (before any engine) ──────────────────────
    _routine = await _match_routine_phrase(req.text)
    if _routine:
        return await _run_routine_phrase(_routine, req.text, req.source, request_id)

    # ── Durable / background / resumable thread mode ────────────────────────
    # With a thread_id the conversation is a persistent server-side object: append
    # the user turn, run the reply as a DETACHED task (survives navigation/disconnect),
    # and return immediately. The reply lands on the thread + is pushed over WS
    # (thread_message) — so the user can leave and come back to it, on ANY chat.
    if req.thread_id:
        import asyncio
        from services import chat_threads as ct
        from services import chat_runner as cr

        ct.ensure_thread(req.thread_id, owner=actor)
        ct.append_message(req.thread_id, "user", req.text)
        await manager.broadcast({
            "type": "thread_message", "thread_id": req.thread_id, "status": "running",
            "message": {"role": "user", "content": req.text},
        })

        async def _compute(text, prior):
            res = await _compute_reply(text, prior, req.source, req.engine, actor,
                                       _new_request_id())
            await _announce_ziggy_response(text, res["reply"], req.source, res["ok"],
                                           res.get("intent"), request_id, res.get("data"))
            return res

        asyncio.create_task(cr.run_turn(req.thread_id, req.text, compute=_compute))
        return {"thread_id": req.thread_id, "status": "running", "request_id": request_id}

    # ── Legacy synchronous mode (unchanged behaviour) ──────────────────────
    res = await _compute_reply(req.text, req.chat_history, req.source, req.engine,
                               actor, request_id)
    await _announce_ziggy_response(req.text, res["reply"], req.source, res["ok"],
                                   res.get("intent"), request_id, res.get("data"))
    return {"reply": res["reply"], "ok": res["ok"], "data": res.get("data", {}),
            "request_id": request_id}


# ── Thread CRUD — persistent conversations for the whole app ────────────────
@router.post("/api/threads")
async def create_chat_thread(request: Request):
    from services import chat_threads as ct
    return {"thread_id": ct.create_thread(owner=_actor_ref(request))}


@router.get("/api/threads")
async def list_chat_threads(request: Request):
    from services import chat_threads as ct
    return {"threads": ct.list_threads(owner=_actor_ref(request))}


@router.get("/api/threads/{thread_id}")
async def get_chat_thread(thread_id: str):
    from fastapi import HTTPException
    from services import chat_threads as ct
    th = ct.get_thread(thread_id)
    if th is None:
        raise HTTPException(status_code=404, detail="thread not found")
    return th


@router.patch("/api/threads/{thread_id}")
async def rename_chat_thread(thread_id: str, body: dict):
    from services import chat_threads as ct
    title = (body or {}).get("title")
    if title:
        ct.rename_thread(thread_id, title)
    return {"ok": True}


@router.delete("/api/threads/{thread_id}")
async def delete_chat_thread(thread_id: str):
    from services import chat_threads as ct
    ct.delete_thread(thread_id)
    return {"ok": True}


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

        # Phrase → routine shortcut (before any engine), same as /api/chat — so
        # a spoken "good night" runs the routine deterministically.
        _routine = await _match_routine_phrase(transcription)
        if _routine:
            res = await _run_routine_phrase(_routine, transcription, "web_voice", request_id)
            res["transcription"] = transcription
            res["lang"] = lang
            return res

        # v2 engine: single agent, voice channel (terse spoken replies).
        try:
            _v2 = _resolve_engine(None) == "v2"
            from core.agent.runner import run_agent as _run_agent  # noqa
        except Exception:
            _v2 = False
        if _v2:
            from core.agent.runner import run_agent
            result = await run_agent(transcription, None, channel="voice")
            reply = result.get("message", "")
            await manager.broadcast({
                "type": "ziggy_response", "input": transcription, "reply": reply,
                "source": "web_voice", "ok": result.get("ok", True),
                "request_id": request_id,
            })
            return {"transcription": transcription, "reply": reply, "lang": lang,
                    "ok": result.get("ok", True), "request_id": request_id, "engine": "v2"}

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
async def process_direct_intent(req: DirectIntentRequest, request: Request):
    request_id = _new_request_id()
    params = dict(req.params or {})
    _actor = _actor_ref(request)
    if _actor:
        params["_actor"] = _actor
    intent_data = {
        "intent": req.intent,
        "params": params,
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
