"""/api/voice/tts/* — voice picker + audition + selection persistence.

Engine-aware: dispatches to whichever module is the active TTS primary
(voice.tts_engine setting). Cartesia is the production default as of
2026-06-19; ElevenLabs is kept as the Premium tier upsell. New engines
just need to be registered in `_ENGINES` and they get the same picker UI
for free.

Read paths (list/active) are cheap and safe. Write paths (preview,
set_active) hit the upstream vendor API or mutate config — they require
auth (enforced at include_router time in backend/server.py).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from core.settings_loader import settings
from interfaces.tts import cartesia_tts, elevenlabs_tts


router = APIRouter(prefix="/api/voice/tts")


_ENGINES: dict[str, Any] = {
    "cartesia":   cartesia_tts,
    "elevenlabs": elevenlabs_tts,
}


def _resolve_engine(name: str | None) -> Any:
    """Resolve the engine module by name. Defaults to the configured
    voice.tts_engine. Raises 400 if name is unknown."""
    if not name:
        name = (settings.get("voice") or {}).get("tts_engine", "cartesia")
    name = str(name).lower()
    engine = _ENGINES.get(name)
    if engine is None:
        raise HTTPException(400, f"Unknown TTS engine {name!r}. "
                                 f"Known: {sorted(_ENGINES)}")
    return engine


# ---------------------------------------------------------------------------
# GET /voices — curated picker list + active selection
# ---------------------------------------------------------------------------
@router.get("/voices")
async def list_voices(engine: str | None = Query(None,
                      description="cartesia | elevenlabs (defaults to active)")):
    """Voices the operator has curated into available_voices, plus the
    current per-language selection. Cheap — no upstream traffic."""
    eng = _resolve_engine(engine)
    return {
        "engine":     engine or settings.get("voice", {}).get("tts_engine"),
        "available":  eng.list_configured_voices(),
        "active":     eng.get_active_voices(),
        "configured": eng.is_available(),
    }


# ---------------------------------------------------------------------------
# GET /voices/discover — live search against the upstream voice library
# ---------------------------------------------------------------------------
@router.get("/voices/discover")
async def discover_voices(lang: str = "he",
                          engine: str | None = Query(None),
                          query: str = "",
                          category: str | None = None,
                          page_size: int = 50):
    """Live search against the upstream voice library, filtered to voices
    verified for `lang`. Hits the vendor — gated to authenticated callers."""
    if lang not in ("he", "en"):
        raise HTTPException(400, "lang must be 'he' or 'en'")
    eng = _resolve_engine(engine)

    # Engine search signatures differ slightly — Cartesia takes (lang, limit),
    # ElevenLabs takes (query, category, page_size) + filters by lang client-side.
    # Dispatch with the args each engine actually accepts.
    if eng is cartesia_tts:
        voices = eng.search_library(lang=lang, limit=page_size)
    else:
        if category and category not in ("premade", "professional", "community"):
            raise HTTPException(400, "category must be premade|professional|community")
        voices = eng.search_library(query=query, category=category, page_size=page_size)
        voices = [v for v in voices if lang in (v.get("languages") or [])]

    return {
        "engine":   engine or settings.get("voice", {}).get("tts_engine"),
        "lang":     lang,
        "matching": len(voices),
        "voices":   voices,
    }


# ---------------------------------------------------------------------------
# POST /preview — render a sample line in a candidate voice
# ---------------------------------------------------------------------------
class PreviewRequest(BaseModel):
    voice_id: str = Field(..., min_length=1)
    text:     str = Field(..., min_length=1, max_length=300)
    lang:     str = Field("he", pattern="^(he|en)$")
    engine:   str | None = Field(None, description="cartesia | elevenlabs")


@router.post("/preview")
async def preview_voice(req: PreviewRequest):
    """Render `text` in `voice_id` and return audio bytes. Bypasses the
    configured selection AND the cache so the picker always hears fresh
    output. Max 300 chars to bound per-call cost."""
    eng = _resolve_engine(req.engine)
    audio = eng.preview(req.text, voice_id=req.voice_id, lang=req.lang)
    if audio is None:
        raise HTTPException(502, "TTS render failed — check API key, voice_id, "
                                 "language support, and server logs.")
    return Response(content=audio, media_type="audio/mpeg")


# ---------------------------------------------------------------------------
# PATCH /active — persist the active voice per language
# ---------------------------------------------------------------------------
class SetActiveRequest(BaseModel):
    he: str | None = Field(None, description="voice_id for Hebrew replies")
    en: str | None = Field(None, description="voice_id for English replies")
    engine: str | None = Field(None, description="cartesia | elevenlabs")


@router.patch("/active")
async def set_active_voices(req: SetActiveRequest):
    """Persist the active voice for either language on the chosen engine."""
    if req.he is None and req.en is None:
        raise HTTPException(400, "At least one of 'he' or 'en' must be provided.")
    eng = _resolve_engine(req.engine)
    if req.he:
        eng.set_active_voice("he", req.he)
    if req.en:
        eng.set_active_voice("en", req.en)
    return {"ok": True, "active": eng.get_active_voices()}
