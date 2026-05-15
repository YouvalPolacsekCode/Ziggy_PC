from __future__ import annotations

import os
import tempfile
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.ws_manager import manager
from core.action_parser import handle_intent
from core.intent_parser import quick_parse
from core.logger_module import log_error, log_info
from core.result_utils import render_result

router = APIRouter()

# Intents that should bypass direct execution in chat mode and go through
# handle_chat_with_gpt (session history + autonomous web search) instead.
# Includes old standalone web-search intents (superseded by GPT tool-calling)
# and any intent that represents casual/conversational input.
_GPT_FALLBACK_INTENTS = frozenset({
    "unrecognized_command",
    "ziggy_chat",          # casual conversation — needs session history
    "web_search_summary",  # superseded by GPT tool-calling
    "web_news_brief",
    "web_recipe_read",
    "web_trip_updates",
    "web_stocks_update",
})


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
    intent_data = quick_parse(req.text)
    intent_data["source"] = req.source
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
    })

    return {
        "reply": reply,
        "ok": result.get("ok", True),
        "intent": broadcast_intent,
        "params": intent_data.get("params", {}),
        "data": result.get("data", {}),
    }


@router.post("/api/chat")
async def process_chat(req: ChatRequest):
    """Chat mode endpoint for the web UI.

    Any intent that quick_parse resolves (lights, sensors, tasks, etc.) executes
    directly — the user can still give real commands from the chat page.

    When nothing is recognized (unrecognized_command) or the match is one of the
    old standalone web-search intents, we fall through to handle_chat_with_gpt,
    which uses GPT with the full session history and autonomous web search.
    """
    parsed = quick_parse(req.text, chat_history=req.chat_history)
    parsed["source"] = req.source

    top_intent = parsed.get("intent")
    # __multi__ is always actionable — never fall through to GPT
    if top_intent not in _GPT_FALLBACK_INTENTS or top_intent == "__multi__":
        result = await handle_intent(parsed)
    else:
        result = await handle_intent({
            "intent": "chat_with_gpt",
            "params": {"text": req.text, "chat_history": req.chat_history},
            "source": req.source,
        })

    reply = render_result(result)

    # For multi-intent, surface the first sub-intent name for logging
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
    })

    return {"reply": reply, "ok": result.get("ok", True), "data": result.get("data", {})}


@router.post("/api/voice")
async def process_voice(file: UploadFile = File(...)):
    suffix = ".wav" if "wav" in (file.content_type or "") else ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        from interfaces.voice_interface import _translate, transcribe
        transcription, lang = transcribe(tmp_path)

        if not transcription.strip():
            return {"reply": "", "transcription": "", "ok": False, "error": "No speech detected"}

        intent_data = quick_parse(transcription)
        intent_data["source"] = "web_voice"
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
        })

        return {"transcription": transcription, "reply": reply, "lang": lang, "ok": result.get("ok", True)}

    except Exception as e:
        log_error(f"[API] Voice error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@router.post("/api/direct-intent")
async def process_direct_intent(req: DirectIntentRequest):
    intent_data = {"intent": req.intent, "params": req.params, "source": req.source}
    result = await handle_intent(intent_data)
    reply = render_result(result)
    await manager.broadcast({
        "type": "ziggy_response",
        "reply": reply,
        "source": req.source,
        "ok": result.get("ok", True),
        "intent": req.intent,
        "params": req.params,
    })
    return {"reply": reply, "ok": result.get("ok", True), "intent": req.intent, "params": req.params}
