"""Cartesia Sonic TTS engine for Ziggy.

The default cloud TTS engine (chosen 2026-06-19 over ElevenLabs after live
auditioning revealed Cartesia has 7 native Hebrew voices — Yardena, Adi,
Gil, Eitan, etc. — vs ElevenLabs' English-trained voices reading Hebrew).

Same defensive shape as elevenlabs_tts: any failure path (no SDK, no key,
quota, network, bad voice_id) returns False so the chain in
voice_interface.speak() falls through cleanly.

Configuration:

    voice:
      tts_enabled: true
      tts_engine: cartesia
      cartesia:
        # api_key lives in config/secrets.yaml
        model_id: sonic-3.5             # only model that supports Hebrew today
        output_format:
          container: mp3
          sample_rate: 44100
          bit_rate: 128000
        selected_voice_he: c5bc902c-bc31-40a8-b81f-7d3a1e1920bd  # Yardena
        selected_voice_en: db6b0ed5-d5d3-463d-ae85-518a07d3c2b4  # Skylar
        cache:
          enabled: true
          max_entries: 200
        available_voices:               # curated picker — kept short on purpose
          - id: c5bc902c-bc31-40a8-b81f-7d3a1e1920bd
            name: "Yardena"
            languages: [he]
            description: "Expert Facilitator — professional female (DEFAULT)"
          - id: 2821fd0c-35c7-4adf-9c42-32e394bf85cb
            name: "Adi"
            languages: [he]
            description: "Efficient Expert — energetic female"
          - id: 84b969ad-19c7-428d-b742-48d387f7f138
            name: "Gil"
            languages: [he]
            description: "Friendly Host — warm male"
          - id: daa4d6bb-da62-4e16-8065-76cd87942475
            name: "Eitan"
            languages: [he]
            description: "Modern Communicator — contemporary male"
          - id: db6b0ed5-d5d3-463d-ae85-518a07d3c2b4
            name: "Skylar"
            languages: [en]
            description: "Friendly Guide — approachable female (DEFAULT EN)"
          - id: 62ae83ad-4f6a-430b-af41-a9bede9286ca
            name: "Gemma"
            languages: [en]
            description: "Decisive Agent — confident British female"
          - id: 65209f8e-6140-4a20-b819-3cc2e21da19b
            name: "Nolan"
            languages: [en]
            description: "Expressive Agent — warm American male"
          - id: ef191366-f52f-447a-a398-ed8c0f2943a1
            name: "Archie"
            languages: [en]
            description: "Approachable Mate — warm British male"

Sonic-3.5 was specifically chosen — sonic-2 returns 400 unsupported_language
for Hebrew (verified live 2026-06-19). Per-voice latency on Cartesia is
sub-500ms in our tests, matching Azure and beating ElevenLabs v3.
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

try:
    from cartesia import Cartesia  # type: ignore
    _SDK_AVAILABLE = True
except Exception:
    Cartesia = None  # type: ignore
    _SDK_AVAILABLE = False


_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_CACHE_DIR = _REPO_ROOT / "cache" / "tts" / "cartesia"

_client: Any = None
_client_key: str | None = None


def _cfg() -> dict:
    return (settings.get("voice") or {}).get("cartesia") or {}


def _api_key() -> str:
    return (
        os.environ.get("CARTESIA_API_KEY")
        or _cfg().get("api_key")
        or ""
    ).strip()


def is_available() -> bool:
    return _SDK_AVAILABLE and bool(_api_key())


def _get_client() -> Any | None:
    global _client, _client_key
    if not is_available():
        return None
    key = _api_key()
    if _client is not None and _client_key == key:
        return _client
    try:
        _client = Cartesia(api_key=key)
        _client_key = key
        return _client
    except Exception as e:
        print(f"[Cartesia] Client init failed: {e}")
        return None


def _resolve_voice_id(lang: str) -> str | None:
    """Pick the active voice for the language. Cartesia voices ARE single-
    language (unlike ElevenLabs Flash/v2 multilingual voices), so we strictly
    use the lang-specific selection — no cross-language fallback."""
    cfg = _cfg()
    if lang == "he":
        return cfg.get("selected_voice_he")
    if lang == "en":
        return cfg.get("selected_voice_en")
    return None


def _output_format() -> dict:
    raw = _cfg().get("output_format") or {}
    return {
        "container":    raw.get("container", "mp3"),
        "sample_rate":  int(raw.get("sample_rate", 44100)),
        "bit_rate":     int(raw.get("bit_rate", 128000)),
    }


def _model_id() -> str:
    # sonic-3.5 is the ONLY Cartesia model that supports Hebrew today.
    # Pinned as default to prevent silent regressions if a future "sonic-3"
    # default surfaces in the SDK that drops Hebrew support.
    return str(_cfg().get("model_id") or "sonic-3.5")


# ---------------------------------------------------------------------------
# Cache — same shape as elevenlabs_tts
# ---------------------------------------------------------------------------
def _cache_cfg() -> tuple[bool, int]:
    c = _cfg().get("cache") or {}
    return bool(c.get("enabled", True)), int(c.get("max_entries", 200))


def _cache_key(text: str, voice_id: str, model_id: str, lang: str, fmt: dict) -> str:
    blob = json.dumps({
        "text": text, "voice": voice_id, "model": model_id,
        "lang": lang, "fmt": fmt,
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
        os.utime(path, None)
    except OSError:
        pass
    return str(path)


def _cache_put(key: str, audio_bytes: bytes) -> str:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _CACHE_DIR / f"{key}.mp3"
    try:
        tmp = path.with_suffix(".mp3.tmp")
        tmp.write_bytes(audio_bytes)
        os.replace(tmp, path)
    except OSError as e:
        print(f"[Cartesia] Cache write failed ({e}) — continuing")
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
def _render(text: str, voice_id: str, lang: str) -> bytes | None:
    client = _get_client()
    if client is None:
        return None
    model_id = _model_id()
    fmt = _output_format()
    try:
        t0 = time.time()
        # Cartesia returns an iterator of bytes chunks even from the
        # non-streaming endpoint; concat because playsound needs a file.
        chunks_iter = client.tts.bytes(
            model_id=model_id,
            transcript=text,
            voice={"mode": "id", "id": voice_id},
            language=lang,
            output_format=fmt,
        )
        chunks: list[bytes] = []
        if isinstance(chunks_iter, (bytes, bytearray)):
            chunks.append(bytes(chunks_iter))
        else:
            for c in chunks_iter:
                if isinstance(c, (bytes, bytearray)):
                    chunks.append(bytes(c))
        audio = b"".join(chunks)
        if not audio:
            print("[Cartesia] Empty audio response — skipping")
            return None
        print(f"[TIMING] cartesia-tts: {time.time() - t0:.2f}s "
              f"({len(audio)} bytes, voice={voice_id[:8]}…, lang={lang})")
        return audio
    except Exception as e:
        # Common failure modes:
        #   - 400 language_not_supported  → voice_id + model_id + lang mismatch
        #   - 401 invalid key             → rotate secret
        #   - 402 / quota exhausted       → upgrade tier; chain falls through
        #   - 404 voice not found         → bad selected_voice_*
        print(f"[Cartesia] Render failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def speak(text: str, lang: str = "en") -> bool:
    if not is_available():
        return False
    voice_id = _resolve_voice_id(lang)
    if not voice_id:
        if is_verbose():
            print(f"[Cartesia] No voice configured for lang={lang}; skipping")
        return False

    model_id = _model_id()
    fmt = _output_format()
    key = _cache_key(text, voice_id, model_id, lang, fmt)

    cached = _cache_get(key)
    if cached is not None:
        if is_verbose():
            print(f"[Cartesia] Cache hit ({Path(cached).name[:12]}…)")
        try:
            playsound.playsound(cached)
            return True
        except Exception as e:
            print(f"[Cartesia] Cached playback failed ({e}) — re-rendering")
            try:
                os.unlink(cached)
            except OSError:
                pass

    audio = _render(text, voice_id, lang)
    if audio is None:
        return False

    out_path = _cache_put(key, audio)
    try:
        playsound.playsound(out_path)
        return True
    except Exception as e:
        print(f"[Cartesia] Playback failed: {e}")
        return False


# ---------------------------------------------------------------------------
# Voice management
# ---------------------------------------------------------------------------
def list_configured_voices() -> list[dict]:
    cfg = _cfg()
    available = cfg.get("available_voices") or []
    return [
        {
            "id":          v.get("id"),
            "name":        v.get("name"),
            "languages":   v.get("languages") or [],
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


def search_library(lang: str = "he", limit: int = 50) -> list[dict]:
    """List all Cartesia voices for a language. Hits the live API.
    Returns [] when SDK/key missing so the picker UI can show
    'configure key first' UX without crashing."""
    client = _get_client()
    if client is None:
        return []
    try:
        out: list[dict] = []
        for v in client.voices.list():
            vlang = getattr(v, 'language', None)
            if vlang != lang:
                continue
            out.append({
                "id":          getattr(v, 'id', None),
                "name":        getattr(v, 'name', None),
                "description": (getattr(v, 'description', '') or '')[:140],
                "language":    vlang,
            })
            if len(out) >= limit:
                break
        return out
    except Exception as e:
        print(f"[Cartesia] Voice search failed: {e}")
        return []


def preview(text: str, voice_id: str, lang: str = "he") -> bytes | None:
    """Render a sample line without touching cache or the active selection.
    Used by the picker UI to audition before committing."""
    return _render(text, voice_id, lang)


def set_active_voice(lang: str, voice_id: str) -> None:
    if lang not in ("he", "en"):
        raise ValueError(f"Unsupported language: {lang!r} (expected 'he' or 'en')")
    voice_cfg = settings.setdefault("voice", {})
    car_cfg = voice_cfg.setdefault("cartesia", {})
    car_cfg[f"selected_voice_{lang}"] = voice_id
    from core.settings_loader import save_settings
    save_settings(settings)
