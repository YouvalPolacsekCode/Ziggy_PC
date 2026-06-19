"""ElevenLabs Text-to-Speech engine for Ziggy.

Slot in voice_interface.speak() as the top-priority engine when configured.
Fails soft on every error path so the existing Azure → Piper → gTTS chain
still serves the reply.

Configuration (config/settings.yaml; secret in config/secrets.yaml):

    voice:
      tts_enabled: true
      tts_engine: elevenlabs
      elevenlabs:
        # api_key lives in config/secrets.yaml — never here.
        model_id: eleven_flash_v2_5         # ~75ms server TTFB, Hebrew supported
        output_format: mp3_44100_128        # plays via playsound on all platforms
        selected_voice_he: <voice_id>
        selected_voice_en: <voice_id>
        voice_settings:
          stability: 0.5
          similarity_boost: 0.75
          style: 0.0
          use_speaker_boost: true
        cache:
          enabled: true
          max_entries: 200                  # ~0–20 MB at 80-char replies
        available_voices:                   # curated picker list
          - id: <voice_id>
            name: "Yael"
            languages: [he, en]
          - id: <voice_id>
            name: "Roi"
            languages: [he, en]

Why non-streaming convert() rather than the stream endpoint:
playsound — the project's audio backend — requires a complete file. Chunked
playback needs a different player (sounddevice/ffplay) and is left as a future
optimization. For ~80-char Hebrew replies on Flash v2.5, full audio is ready
within ~400-600ms end-to-end from Israel via the NL PoP, which matches what
Azure delivers today.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import playsound

from core.settings_loader import settings
from services.debug_control import is_verbose

# ---------------------------------------------------------------------------
# SDK availability — try-import once so missing dep degrades to "engine off"
# instead of crashing the voice loop.
# ---------------------------------------------------------------------------
try:
    from elevenlabs.client import ElevenLabs  # type: ignore
    _SDK_AVAILABLE = True
except Exception:
    ElevenLabs = None  # type: ignore
    _SDK_AVAILABLE = False

# Voice settings dataclass moved across SDK versions; tolerate both locations
# and a plain-dict fallback so we don't break on minor SDK bumps.
try:
    from elevenlabs.types import VoiceSettings  # type: ignore
except Exception:
    try:
        from elevenlabs import VoiceSettings  # type: ignore
    except Exception:
        VoiceSettings = None  # type: ignore


_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_CACHE_DIR = _REPO_ROOT / "cache" / "tts" / "elevenlabs"

# Module-level client cache. The SDK holds a requests.Session under the hood;
# rebuilding it per call burns ~10ms on TLS handshake.
_client: Any = None
_client_key: str | None = None


def _cfg() -> dict:
    """Re-read voice config on every call — settings can change at runtime via
    the /api/voice/tts/active endpoint, and we never want a stale snapshot."""
    return (settings.get("voice") or {}).get("elevenlabs") or {}


def _api_key() -> str:
    """Env var wins (12-factor / CI override), then config/secrets.yaml,
    then settings.yaml as last resort. Loader already merges secrets+env into
    `settings`, so checking env explicitly is belt-and-suspenders."""
    return (
        os.environ.get("ELEVENLABS_API_KEY")
        or _cfg().get("api_key")
        or ""
    ).strip()


def is_available() -> bool:
    """True when the engine can plausibly serve a request right now.
    Used by the engine-chain guard in voice_interface.speak()."""
    return _SDK_AVAILABLE and bool(_api_key())


def _get_client() -> Any | None:
    """Lazy SDK client, rebuilt only if the API key changed (rotation)."""
    global _client, _client_key
    if not is_available():
        return None
    key = _api_key()
    if _client is not None and _client_key == key:
        return _client
    try:
        _client = ElevenLabs(api_key=key)
        _client_key = key
        return _client
    except Exception as e:
        print(f"[ElevenLabs] Client init failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Voice resolution
# ---------------------------------------------------------------------------
def _resolve_voice_id(lang: str) -> str | None:
    """Pick the active voice for the language. Falls back to the other-language
    voice if only one is configured — Flash v2.5 supports both EN and HE from a
    single voice_id, so this is a safe degrade."""
    cfg = _cfg()
    if lang == "he":
        return cfg.get("selected_voice_he") or cfg.get("selected_voice_en")
    return cfg.get("selected_voice_en") or cfg.get("selected_voice_he")


def _voice_settings_dict() -> dict:
    """Defaults match ElevenLabs' own recommendations: stability 0.5,
    similarity_boost 0.75. style=0 disables exaggeration (best for assistant
    voice). use_speaker_boost=true sharpens timbre on the source speaker."""
    raw = _cfg().get("voice_settings") or {}
    return {
        "stability":         float(raw.get("stability", 0.5)),
        "similarity_boost":  float(raw.get("similarity_boost", 0.75)),
        "style":             float(raw.get("style", 0.0)),
        "use_speaker_boost": bool(raw.get("use_speaker_boost", True)),
    }


def _build_voice_settings_obj(d: dict) -> Any:
    """Return either a typed VoiceSettings instance (preferred) or the raw
    dict; SDKs ≥2.x accept dict, older ones need the typed object."""
    if VoiceSettings is not None:
        try:
            return VoiceSettings(**d)
        except Exception:
            return d
    return d


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
def _cache_cfg() -> tuple[bool, int]:
    c = _cfg().get("cache") or {}
    return bool(c.get("enabled", True)), int(c.get("max_entries", 200))


def _cache_key(text: str, voice_id: str, model_id: str, vs: dict,
               lang: str, fmt: str) -> str:
    """Stable hash over every input that affects rendered audio. Changing any
    voice_setting invalidates the cache for that text — desired behavior."""
    blob = json.dumps({
        "text":  text,
        "voice": voice_id,
        "model": model_id,
        "vs":    vs,
        "lang":  lang,
        "fmt":   fmt,
    }, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _cache_get(key: str) -> str | None:
    enabled, _ = _cache_cfg()
    if not enabled:
        return None
    path = _CACHE_DIR / f"{key}.mp3"
    if not path.exists() or path.stat().st_size == 0:
        return None
    try:
        os.utime(path, None)  # bump mtime so LRU eviction keeps hot entries
    except OSError:
        pass
    return str(path)


def _cache_put(key: str, audio_bytes: bytes) -> str:
    """Write audio to cache and evict oldest entries beyond the cap. Returns
    the cached file path. Cache write failures are non-fatal — we still play."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _CACHE_DIR / f"{key}.mp3"
    try:
        # Atomic write so a crash mid-write doesn't leave a half-file that
        # poisons future cache hits.
        tmp = path.with_suffix(".mp3.tmp")
        tmp.write_bytes(audio_bytes)
        os.replace(tmp, path)
    except OSError as e:
        print(f"[ElevenLabs] Cache write failed ({e}) — continuing")
        # Fall back to a temp file outside the cache dir so playback still works.
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as fp:
            fp.write(audio_bytes)
            return fp.name

    _, max_entries = _cache_cfg()
    try:
        entries = sorted(_CACHE_DIR.glob("*.mp3"), key=lambda p: p.stat().st_mtime)
        for victim in entries[: max(0, len(entries) - max_entries)]:
            try:
                victim.unlink()
            except OSError:
                pass
    except OSError:
        pass
    return str(path)


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
def _model_id() -> str:
    # Multilingual v2 is the right default for Ziggy: Hebrew works (when
    # language_code is omitted — see _send_language_code), ~1s render for
    # short replies, all 21 premade voices available. Flash v2.5 is faster
    # (~75ms TTFB) but the API explicitly rejects language_code='he' on it,
    # so it's English-only in practice. Eleven v3 supports Hebrew with
    # language_code='he' but is ~2x slower than v2 — reserve for content,
    # not assistant replies.
    return str(_cfg().get("model_id") or "eleven_multilingual_v2")


# Models that accept language_code='he'. Flash v2.5 and Multilingual v2
# return 400 unsupported_language when 'he' is passed; Multilingual v2 also
# ignores language_code generally per the docs and auto-detects from text.
# Only Eleven v3 (the flagship) accepts Hebrew via language_code at the time
# this was wired (Jun 2026).
_MODELS_ACCEPTING_HE = frozenset({"eleven_v3"})


def _send_language_code(model_id: str, lang: str) -> str | None:
    """Decide whether to attach language_code to the request.
    English is safe to pass on every model. Hebrew is only safe on v3 —
    sending it on v2/Flash returns 400. When unsafe, return None and let
    the model auto-detect from the input text."""
    if lang == "he":
        return "he" if model_id in _MODELS_ACCEPTING_HE else None
    if lang == "en":
        return "en"
    return None


def _output_format() -> str:
    # mp3_44100_128 is the SDK default and plays cleanly via `playsound` on
    # macOS and Windows. Higher bitrates (192 kbps) and raw PCM are tier-gated
    # to Pro+ — sticking with the default keeps Starter/Creator working too.
    return str(_cfg().get("output_format") or "mp3_44100_128")


def _render(text: str, voice_id: str, lang: str) -> bytes | None:
    """Call ElevenLabs convert endpoint and return audio bytes.
    Returns None on any failure so the caller can fall through to the next
    engine in the chain."""
    client = _get_client()
    if client is None:
        return None

    model_id = _model_id()
    fmt      = _output_format()
    vs_dict  = _voice_settings_dict()
    vs_obj   = _build_voice_settings_obj(vs_dict)

    # language_code policy depends on model — see _send_language_code. Sending
    # 'he' on Multilingual v2 or Flash v2.5 returns 400 unsupported_language,
    # so we suppress it for those models and trust the model to auto-detect
    # from the Hebrew text. Confirmed: Sarah on v2 with no language_code
    # produces accurate Hebrew on the live API.
    kwargs: dict[str, Any] = {
        "text":           text,
        "voice_id":       voice_id,
        "model_id":       model_id,
        "output_format":  fmt,
        "voice_settings": vs_obj,
    }
    lc = _send_language_code(model_id, lang)
    if lc:
        kwargs["language_code"] = lc

    try:
        t0 = time.time()
        # SDK returns a generator of bytes chunks even from convert(); concat
        # because playsound needs a complete file.
        audio_iter = client.text_to_speech.convert(**kwargs)
        chunks: list[bytes] = []
        for chunk in audio_iter:
            if isinstance(chunk, (bytes, bytearray)):
                chunks.append(bytes(chunk))
        audio_bytes = b"".join(chunks)
        if not audio_bytes:
            print("[ElevenLabs] Empty audio response — skipping")
            return None
        print(f"[TIMING] elevenlabs-tts: {time.time() - t0:.2f}s "
              f"({len(audio_bytes)} bytes, voice={voice_id[:8]}…, model={model_id})")
        return audio_bytes
    except Exception as e:
        # Most common failure modes:
        #   - 401 invalid key            → operator needs to update secrets
        #   - 402 / quota_exceeded       → operator needs to upgrade tier
        #   - 400 voice_not_found        → bad selected_voice_* — fix config
        #   - network timeout            → falls through to Azure/Piper/gTTS
        print(f"[ElevenLabs] Render failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Public API used by voice_interface.speak()
# ---------------------------------------------------------------------------
def speak(text: str, lang: str = "en") -> bool:
    """Render `text` via ElevenLabs and play via playsound.
    Returns True on success; False signals the caller to try the next engine."""
    if not is_available():
        return False

    voice_id = _resolve_voice_id(lang)
    if not voice_id:
        if is_verbose():
            print(f"[ElevenLabs] No voice configured for lang={lang}; skipping")
        return False

    model_id = _model_id()
    fmt      = _output_format()
    vs_dict  = _voice_settings_dict()
    key      = _cache_key(text, voice_id, model_id, vs_dict, lang, fmt)

    cached = _cache_get(key)
    if cached is not None:
        if is_verbose():
            print(f"[ElevenLabs] Cache hit ({Path(cached).name[:12]}…)")
        try:
            playsound.playsound(cached)
            return True
        except Exception as e:
            print(f"[ElevenLabs] Cached playback failed ({e}) — re-rendering")
            try:
                os.unlink(cached)
            except OSError:
                pass

    audio_bytes = _render(text, voice_id, lang)
    if audio_bytes is None:
        return False

    out_path = _cache_put(key, audio_bytes)
    try:
        playsound.playsound(out_path)
        return True
    except Exception as e:
        print(f"[ElevenLabs] Playback failed: {e}")
        return False


# ---------------------------------------------------------------------------
# Voice management — used by /api/voice/tts/* endpoints + discovery script
# ---------------------------------------------------------------------------
def list_configured_voices() -> list[dict]:
    """The curated picker list from settings.yaml. Empty list if none configured.
    Returns the active selection per language alongside the catalog so the UI
    can highlight the current pick."""
    cfg = _cfg()
    available = cfg.get("available_voices") or []
    return [
        {
            "id":         v.get("id"),
            "name":       v.get("name"),
            "languages":  v.get("languages") or [],
            "description": v.get("description") or "",
        }
        for v in available
        if v.get("id")
    ]


def get_active_voices() -> dict:
    cfg = _cfg()
    return {
        "he": cfg.get("selected_voice_he"),
        "en": cfg.get("selected_voice_en"),
    }


def search_library(query: str = "", category: str | None = None,
                   page_size: int = 30) -> list[dict]:
    """Hit ElevenLabs' /v2/voices search and return voices that ElevenLabs has
    verified for Hebrew. Returns [] when SDK/key unavailable so callers can
    show "configure key first" UX without crashing.

    The `verified_languages` field on each voice tells us which languages
    ElevenLabs has confirmed for that voice — far better than scraping names.
    """
    client = _get_client()
    if client is None:
        return []
    try:
        kwargs: dict[str, Any] = {"page_size": page_size}
        if query:
            kwargs["search"] = query
        if category:
            kwargs["category"] = category
        resp = client.voices.search(**kwargs)
    except Exception as e:
        print(f"[ElevenLabs] Voice search failed: {e}")
        return []

    # SDK response shape: object with `.voices` list. Each voice has `.voice_id`,
    # `.name`, `.category`, `.verified_languages` (list of objects with
    # `.language`, `.preview_url`, `.accent`, `.locale`).
    voices = getattr(resp, "voices", None) or []
    out: list[dict] = []
    for v in voices:
        verified = getattr(v, "verified_languages", None) or []
        langs = [str(getattr(vl, "language", "")).lower() for vl in verified]
        previews = {
            str(getattr(vl, "language", "")).lower(): getattr(vl, "preview_url", None)
            for vl in verified
        }
        out.append({
            "id":        getattr(v, "voice_id", None),
            "name":      getattr(v, "name", None),
            "category":  getattr(v, "category", None),
            "languages": langs,
            "preview_urls": previews,
            # Top-level preview_url is whatever default ElevenLabs picks.
            "preview_url": getattr(v, "preview_url", None),
        })
    return out


def preview(text: str, voice_id: str, lang: str = "he") -> bytes | None:
    """Render a sample line in a candidate voice without touching cache or the
    configured selection. Used by the picker UI to audition before committing."""
    return _render(text, voice_id, lang)


def set_active_voice(lang: str, voice_id: str) -> None:
    """Persist the active voice for `lang` to config/settings.yaml.
    Mutates the in-memory settings dict so subsequent speak() calls see the
    change immediately."""
    if lang not in ("he", "en"):
        raise ValueError(f"Unsupported language: {lang!r} (expected 'he' or 'en')")
    voice_cfg = settings.setdefault("voice", {})
    el_cfg = voice_cfg.setdefault("elevenlabs", {})
    el_cfg[f"selected_voice_{lang}"] = voice_id
    from core.settings_loader import save_settings  # late import to avoid cycle
    save_settings(settings)
