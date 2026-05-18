from __future__ import annotations

import os
import tempfile
import uuid
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.ws_manager import manager
from core.action_parser import handle_intent
from core.intent_parser import quick_parse
from core.logger_module import log_error, log_info
from core.result_utils import render_result
from core.debug_bus import bus, BASIC, VERBOSE

router = APIRouter()

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
    if top_intent not in _GPT_FALLBACK_INTENTS:
        from interfaces.voice_interface import _translate, is_hebrew as _is_hebrew
        if _is_hebrew(req.text) and reply and not _is_hebrew(reply):
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


@router.post("/api/voice")
async def process_voice(file: UploadFile = File(...)):
    request_id = _new_request_id()
    suffix = ".wav" if "wav" in (file.content_type or "") else ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        bus.emit("voice", BASIC, "voice_received",
                 request_id=request_id,
                 content_type=file.content_type)

        from interfaces.voice_interface import _translate, transcribe_web
        transcription, lang = transcribe_web(tmp_path)

        bus.emit("voice", VERBOSE, "voice_transcribed",
                 request_id=request_id,
                 transcription=transcription,
                 language=lang,
                 empty=not transcription.strip())

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
