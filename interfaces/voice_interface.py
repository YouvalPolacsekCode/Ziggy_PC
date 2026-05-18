# interfaces/voice_interface.py

import os
import re
import tempfile
import uuid
import time
import asyncio
import shutil
import subprocess
from collections import deque
from pathlib import Path

import numpy as np
import sounddevice as sd
import speech_recognition as sr
from gtts import gTTS
import playsound
from faster_whisper import WhisperModel

from core.settings_loader import settings
from services.debug_control import is_verbose, toggle_verbose
from core.intent_parser import quick_parse
from core.action_parser import handle_intent
from core.result_utils import render_result
from core.session_manager import (
    MODE_COMMAND, MODE_CHAT,
    CHAT_ALLOWED_INTENTS,
    is_chat_trigger, is_command_trigger,
    get_voice_mode, set_voice_mode,
    get_voice_chat_history, append_voice_chat,
    reset_voice_session,
)
from core.response_templates import get_response

# ===== Settings / Config =====
VOICE_CFG = settings.get("voice", {})
HEBREW_MODEL_ID = VOICE_CFG.get("hebrew_model", "ivrit-ai/whisper-large-v3-turbo-ct2")
WAKEWORD_ENABLED = bool(VOICE_CFG.get("wakeword_enabled", False))
WAKEWORD_ENGINE = str(VOICE_CFG.get("wakeword_engine", "oww")).lower()
WAKEWORD_MODEL_NAME = VOICE_CFG.get("wakeword_model", "hey_mycroft")
WAKEWORD_THRESHOLD = float(VOICE_CFG.get("wakeword_threshold", 0.65))
WAKEWORD_HITS = int(VOICE_CFG.get("wakeword_hits", 3))
WAKEWORD_COOLDOWN_MS = int(VOICE_CFG.get("wakeword_cooldown_ms", 1200))
PORCUPINE_KEYWORD = VOICE_CFG.get("porcupine_keyword", "porcupine")
PORCUPINE_ACCESS_KEY = VOICE_CFG.get("porcupine_access_key")
STT_LANGUAGE = str(VOICE_CFG.get("stt_language", "auto")).lower()
ACTIVE_CONVERSATION_TIMEOUT = int(VOICE_CFG.get("active_timeout_s", 90))

WW_SAMPLE_RATE = 16000
WW_BLOCK_SIZE = 512

# ===== STT — tuned for sensitivity =====
recognizer = sr.Recognizer()
recognizer.energy_threshold = 200           # starting point; calibration may adjust
recognizer.dynamic_energy_threshold = False  # OFF — dynamic mode drifts too high after loud sounds
recognizer.pause_threshold = 1.0            # wait 1s of silence before cutting off

_whisper_base = None
_whisper_hebrew = None
_whisper_lock = __import__("threading").Lock()

def _get_whisper() -> WhisperModel:
    """Local base model — used for language detection and English transcription."""
    global _whisper_base
    if _whisper_base is None:
        with _whisper_lock:
            if _whisper_base is None:
                _whisper_base = WhisperModel("base", compute_type="int8")
    return _whisper_base


def _get_whisper_hebrew() -> WhisperModel | None:
    """Load the Hebrew-specific Whisper model (ivrit-ai). Returns None if unavailable."""
    global _whisper_hebrew
    if _whisper_hebrew is not None:
        return _whisper_hebrew
    with _whisper_lock:
        if _whisper_hebrew is not None:
            return _whisper_hebrew
        try:
            t0 = time.time()
            _whisper_hebrew = WhisperModel(HEBREW_MODEL_ID, compute_type="int8")
            print(f"[TIMING] hebrew-model-load: {time.time() - t0:.2f}s ({HEBREW_MODEL_ID})")
            return _whisper_hebrew
        except Exception as e:
            print(f"[STT] Hebrew model load failed ({e}) — will fall back to API")
            return None


def _prewarm_models() -> None:
    """Load the base Whisper model at startup.

    The Hebrew ivrit-ai model (30s+ on CPU) is NOT pre-warmed here — web voice
    uses the OpenAI API instead, so the local Hebrew model is only needed as a
    fallback when the API is completely unavailable. Loading it eagerly would
    block 30s of background CPU for something rarely used.
    """
    try:
        _get_whisper()
        print("[Voice] Whisper base model pre-warmed.")
    except Exception as e:
        print(f"[Voice] Pre-warm failed: {e}")

# Kick off pre-warming immediately — daemon thread so it doesn't block shutdown.
__import__("threading").Thread(target=_prewarm_models, daemon=True, name="WhisperPrewarm").start()


_HE_INITIAL_PROMPT = (
    "זיגי, הדלק, כבה, מזגן, תאורה, אור, סלון, משרד, מטבח, חדר שינה, "
    "תריסים, מאוורר, טמפרטורה, לחות, מצב הבית, לילה טוב, "
    "הגדר, כוון, הוסף משימה, תזכורת"
)

def _transcribe_local_hebrew(audio_path: str) -> tuple[str, str]:
    """Transcribe Hebrew audio using the local ivrit-ai model. No API cost."""
    t0 = time.time()
    model = _get_whisper_hebrew()
    if model is None:
        return _transcribe_api(audio_path)
    try:
        segments_iter, _ = model.transcribe(
            audio_path,
            beam_size=1,           # was 5 — beam_size=1 is ~5x faster, fine for short commands
            temperature=0,         # greedy decoding, no sampling overhead
            language="he",
            initial_prompt=_HE_INITIAL_PROMPT,
            vad_filter=True,       # skip silence at start/end — reduces effective audio length
            condition_on_previous_text=False,  # no inter-segment dependency overhead
            without_timestamps=True,
        )
        text = " ".join(s.text for s in segments_iter).strip()
        print(f"[TIMING] hebrew-local-stt: {time.time() - t0:.2f}s")
        return text, "he"
    except Exception as e:
        print(f"[STT] Local Hebrew model failed ({e}) — falling back to API")
        return _transcribe_api(audio_path)


def _transcribe_api(audio_path: str) -> tuple[str, str]:
    """Fallback: transcribe Hebrew audio via OpenAI Whisper API."""
    t0 = time.time()
    try:
        from integrations.openai_client import get_client
        with open(audio_path, "rb") as f:
            result = get_client().audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="he",
            )
        text = result.text.strip()
        print(f"[TIMING] openai-whisper-api: {time.time() - t0:.2f}s")
        return text, "he"
    except Exception as e:
        print(f"[STT] OpenAI API failed ({e}) — returning empty")
        return "", "he"

# ===== TTS engine config =====
_REPO_ROOT = Path(__file__).parent.parent
TTS_ENGINE       = VOICE_CFG.get("tts_engine", "piper").lower()

# ── Piper ──────────────────────────────────────────────────────────────────
_PIPER_EXE      = shutil.which("piper") or shutil.which("piper.exe")
_PIPER_VOICE    = _REPO_ROOT / "piper_voices" / "en_US-libritts_r-medium.onnx"
_PIPER_VOICE_HE = _REPO_ROOT / "piper_voices" / "he_IL-sivri-medium.onnx"

# ── Azure Cognitive Services Neural TTS ────────────────────────────────────
_AZURE_CFG      = VOICE_CFG.get("azure") or {}
_AZURE_KEY      = _AZURE_CFG.get("speech_key") or os.environ.get("AZURE_SPEECH_KEY", "")
_AZURE_REGION   = _AZURE_CFG.get("speech_region", "eastus")
_AZURE_VOICE_HE = _AZURE_CFG.get("voice_he", "he-IL-HilaNeural")
_AZURE_VOICE_EN = _AZURE_CFG.get("voice_en", "en-US-JennyNeural")

# ===== Hebrew helpers =====
def is_hebrew(text: str) -> bool:
    return any('\u0590' <= c <= '\u05EA' for c in text or "")

try:
    from bidi.algorithm import get_display as _bidi_display
    def fix_hebrew_direction(text: str) -> str:
        return _bidi_display(text or "") if is_hebrew(text) else (text or "")
except ImportError:
    def fix_hebrew_direction(text: str) -> str:
        return text or ""

# ===== Instant Hebrew replies =============================================
# Pre-translated responses for the 15 most common action patterns.
# Zero latency, zero API cost, grammatically correct Israeli Hebrew.
# _translate() tries this first; falls through to Ollama/GPT for unknowns.

# Build reverse map: English slug → preferred Hebrew room name (longest wins)
_EN_SLUG_TO_HE: dict[str, str] = {}
for _he_r, _slug_r in settings.get("room_aliases_he", {}).items():
    if len(_he_r) > len(_EN_SLUG_TO_HE.get(_slug_r, "")):
        _EN_SLUG_TO_HE[_slug_r] = _he_r

def _room_to_he(display: str) -> str:
    """Convert English room display name from a handler response to Hebrew."""
    slug = display.strip().lower().replace(" ", "_")
    return _EN_SLUG_TO_HE.get(slug, display)

# Regex patterns for handler response strings (all anchored to full message)
# ── Lights ────────────────────────────────────────────────────────────────────
_P_LIGHT_ON     = re.compile(r"^Turning on (.+?) light\.$")
_P_LIGHT_OFF    = re.compile(r"^Turning off (.+?) light\.$")
_P_LIGHT_COLOR  = re.compile(r"^(.+?) [Ll]ight color set to (.+?)\.$")
_P_LIGHT_DIM    = re.compile(r"^(.+?) [Ll]ight brightness set to (\d+)%\.$")
_P_ALL_LIGHTS   = re.compile(r"^All lights turned off \(\d+ lights?\)\.$")
_P_ROOM_LIGHTS  = re.compile(r"^Turned (?:on|off) all lights in (.+?) \(\d+ lights?\)\.$")
_P_ALREADY_OFF  = re.compile(r"^All lights are already off\.$")
# ── AC ───────────────────────────────────────────────────────────────────────
_P_AC_ON        = re.compile(r"^Turning on (.+?) AC\.$")
_P_AC_OFF       = re.compile(r"^Turning off (.+?) AC\.$")
_P_AC_TEMP      = re.compile(r"^Setting (.+?) AC to (\d+)°C\.$")
# ── TV ───────────────────────────────────────────────────────────────────────
_P_TV_ON        = re.compile(r"^Turning on the TV\.$")
_P_TV_OFF       = re.compile(r"^Turning off the TV\.$")
_P_TV_SOURCE    = re.compile(r"^Switching TV to (.+?)\.$")
# ── Notes / files ─────────────────────────────────────────────────────────────
_P_NOTE_SAVED   = re.compile(r"^Note saved\.")
_P_NOTE_ASK     = re.compile(r"^What should I save in the note\?$")
_P_NOTE_APPEND  = re.compile(r"^Which note should I append to\?$")
_P_NOTE_WHAT    = re.compile(r"^What should I append\?$")
_P_NOTE_SEARCH  = re.compile(r"^What should I search for in your notes\?$")
_P_NOTE_NONE    = re.compile(r"^No notes found matching '(.+?)'\.$")
# ── Sensors ───────────────────────────────────────────────────────────────────
_P_SENSOR_VAL   = re.compile(r"^The (\w+) in (.+?) is ([\d.]+)\s*(.*)\.$")
_P_SENSOR_NA    = re.compile(r"^The (\w+) in (.+?) is currently unavailable\.$")
# ── Everything off ────────────────────────────────────────────────────────────
_P_ALL_OFF      = re.compile(r"^Everything off\.")
# ── Clarifications ────────────────────────────────────────────────────────────
_P_WHICH_ROOM   = re.compile(r"Which room'?s?\b")
_P_WHICH_DEVICE = re.compile(r"Which device\b", re.IGNORECASE)
_P_WHICH_TASK   = re.compile(r"Which task\b", re.IGNORECASE)
# ── Automations ───────────────────────────────────────────────────────────────
_P_AUTO_CREATED = re.compile(r"^Done! '(.+)' has been set up\.$")
_P_AUTO_UPDATED = re.compile(r"^Done! '(.+)' has been updated\.$")
_P_AUTO_ASSIGNED= re.compile(r"^Done! '(.+)' is now assigned to (.+)\.$")
_P_AUTO_DELETED = re.compile(r"^Automation '(.+)' deleted\.$")
_P_AUTO_ENABLED = re.compile(r"^Automation '(.+)' (enabled|disabled)\.$")
_P_AUTO_NONE    = re.compile(r"^No automations found\.$")
_P_AUTO_MISSING = re.compile(r"^Which room and device should this automation control")
_P_AUTO_LIST    = re.compile(r"^You have (\d+) automations?:\n")
# ── Tasks ─────────────────────────────────────────────────────────────────────
_P_TASK_ADDED   = re.compile(r"^Task added: (.+?) \(due: (.+?), priority: (.+?)\)$")
_P_TASK_NONE    = re.compile(r"^(?:📭 )?No tasks yet\.$")
_P_TASK_ASK     = re.compile(r"^What task would you like to add\?$")
_P_TASK_MARK_ASK= re.compile(r"^Which task should I mark as done\?$")
_P_TASK_DONE    = re.compile(r"^Task '(.+)' marked as done\.$")
_P_TASK_REMOVED = re.compile(r"^Task '(.+)' removed\.$")
# ── Generic device control (device_handler) ───────────────────────────────────
_P_DEVICE_ACT   = re.compile(r"^(Open|Close|Lock|Unlock|Turn on|Turn off|Start|Stop|Dock|Pause|Resume|Arm|Disarm): (.+)\.$")
_DEVICE_VERB_HE = {
    "Open": "פותח", "Close": "סוגר", "Lock": "נועל", "Unlock": "פותח",
    "Turn on": "מפעיל", "Turn off": "מכבה",
    "Start": "מפעיל", "Stop": "עוצר",
    "Dock": "מחזיר לעריסה", "Pause": "מפסיק", "Resume": "ממשיך",
    "Arm": "מאבטח", "Disarm": "מבטל אבטחה",
}
# ── Ziggy identity ────────────────────────────────────────────────────────────
_P_ZIGGY_ID     = re.compile(r"^I'm Ziggy, built by")
_P_ZIGGY_STATUS = re.compile(r"^I'm Ziggy, your home assistant\.")

_COLOR_HE = {
    "red": "אדום", "green": "ירוק", "blue": "כחול", "yellow": "צהוב",
    "white": "לבן", "orange": "כתום", "purple": "סגול", "pink": "ורוד",
    "warm white": "לבן חם", "cool white": "לבן קר",
}
_SENSOR_HE = {"temperature": "טמפרטורה", "humidity": "לחות"}


_PRIORITY_HE = {"high": "גבוהה", "medium": "בינונית", "low": "נמוכה"}


def _he_instant_reply(text: str) -> str | None:
    """Return a pre-translated Hebrew string for common handler responses.
    Returns None if no pattern matches — caller falls through to API translation.
    """
    # ── Lights ───────────────────────────────────────────────────────────────
    m = _P_LIGHT_ON.match(text)
    if m:
        return f"מדליק את האור ב{_room_to_he(m.group(1))}."

    m = _P_LIGHT_OFF.match(text)
    if m:
        return f"מכבה את האור ב{_room_to_he(m.group(1))}."

    m = _P_LIGHT_COLOR.match(text)
    if m:
        color_he = _COLOR_HE.get(m.group(2).lower(), m.group(2))
        return f"צבע האור ב{_room_to_he(m.group(1).lower())} הוגדר ל{color_he}."

    m = _P_LIGHT_DIM.match(text)
    if m:
        return f"עוצמת האור ב{_room_to_he(m.group(1).lower())} הוגדרה ל-{m.group(2)}%."

    if _P_ALL_LIGHTS.match(text) or _P_ALREADY_OFF.match(text):
        return "כל האורות כבויים."

    m = _P_ROOM_LIGHTS.match(text)
    if m:
        return f"כל האורות ב{_room_to_he(m.group(1))} כבויים."

    # ── AC ───────────────────────────────────────────────────────────────────
    m = _P_AC_ON.match(text)
    if m:
        return f"מפעיל את המזגן ב{_room_to_he(m.group(1))}."

    m = _P_AC_OFF.match(text)
    if m:
        return f"מכבה את המזגן ב{_room_to_he(m.group(1))}."

    m = _P_AC_TEMP.match(text)
    if m:
        return f"מגדיר את המזגן ב{_room_to_he(m.group(1))} ל-{m.group(2)} מעלות."

    # ── Everything off ────────────────────────────────────────────────────────
    if _P_ALL_OFF.match(text):
        return "הכל כבוי. לילה טוב!"

    # ── Sensors ───────────────────────────────────────────────────────────────
    m = _P_SENSOR_VAL.match(text)
    if m:
        sensor_he = _SENSOR_HE.get(m.group(1), m.group(1))
        room_he   = _room_to_he(m.group(2))
        val, unit = m.group(3), m.group(4)
        return f"ה{sensor_he} ב{room_he} עומדת על {val}{' ' + unit if unit else ''}."

    m = _P_SENSOR_NA.match(text)
    if m:
        sensor_he = _SENSOR_HE.get(m.group(1), m.group(1))
        return f"ה{sensor_he} ב{_room_to_he(m.group(2))} אינה זמינה כרגע."

    # ── Automations ───────────────────────────────────────────────────────────
    m = _P_AUTO_CREATED.match(text)
    if m:
        return f"בוצע! האוטומציה '{m.group(1)}' נוצרה."

    m = _P_AUTO_UPDATED.match(text)
    if m:
        return f"בוצע! האוטומציה '{m.group(1)}' עודכנה."

    m = _P_AUTO_ASSIGNED.match(text)
    if m:
        return f"בוצע! '{m.group(1)}' שויכה ל{_room_to_he(m.group(2))}."

    m = _P_AUTO_DELETED.match(text)
    if m:
        return f"האוטומציה '{m.group(1)}' נמחקה."

    m = _P_AUTO_ENABLED.match(text)
    if m:
        state_he = "הופעלה" if m.group(2) == "enabled" else "כובתה"
        return f"האוטומציה '{m.group(1)}' {state_he}."

    if _P_AUTO_NONE.match(text):
        return "לא נמצאו אוטומציות."

    if _P_AUTO_MISSING.match(text):
        return "באיזה חדר ואיזה מכשיר האוטומציה תשלוט? ומתי היא תופעל?"

    m = _P_AUTO_LIST.match(text)
    if m:
        # Pass through to translation — the automation names may be Hebrew or mixed
        return None

    # ── Tasks ─────────────────────────────────────────────────────────────────
    if _P_TASK_ASK.match(text):
        return "מה המשימה שתרצה להוסיף?"

    if _P_TASK_MARK_ASK.match(text):
        return "איזו משימה לסמן כבוצעה?"

    if _P_TASK_NONE.match(text):
        return "אין משימות כרגע."

    m = _P_TASK_ADDED.match(text)
    if m:
        task_name = m.group(1)
        due       = m.group(2)
        priority_he = _PRIORITY_HE.get(m.group(3).strip(), m.group(3))
        return f"המשימה '{task_name}' נוספה. עד: {due}, עדיפות: {priority_he}."

    m = _P_TASK_DONE.match(text)
    if m:
        return f"המשימה '{m.group(1)}' סומנה כבוצעה."

    m = _P_TASK_REMOVED.match(text)
    if m:
        return f"המשימה '{m.group(1)}' נמחקה."

    # ── Clarifications (catch-all) ────────────────────────────────────────────
    if _P_WHICH_ROOM.search(text):
        return "איזה חדר?"

    if _P_WHICH_DEVICE.search(text):
        return "איזה מכשיר?"

    if _P_WHICH_TASK.search(text):
        return "איזו משימה?"

    # ── Generic device control ────────────────────────────────────────────────
    m = _P_DEVICE_ACT.match(text)
    if m:
        verb_he = _DEVICE_VERB_HE.get(m.group(1), m.group(1))
        return f"{verb_he} את {m.group(2)}."

    # ── TV ───────────────────────────────────────────────────────────────────
    if _P_TV_ON.match(text):
        return "מדליק את הטלוויזיה."

    if _P_TV_OFF.match(text):
        return "מכבה את הטלוויזיה."

    m = _P_TV_SOURCE.match(text)
    if m:
        return f"עובר למקור {m.group(1)} בטלוויזיה."

    # ── Notes / files ─────────────────────────────────────────────────────────
    if _P_NOTE_SAVED.match(text):
        return "הפתק נשמר."

    if _P_NOTE_ASK.match(text):
        return "מה לשמור בפתק?"

    if _P_NOTE_APPEND.match(text):
        return "לאיזה פתק להוסיף?"

    if _P_NOTE_WHAT.match(text):
        return "מה להוסיף?"

    if _P_NOTE_SEARCH.match(text):
        return "מה לחפש בפתקים?"

    m = _P_NOTE_NONE.match(text)
    if m:
        return f"לא נמצאו פתקים עם '{m.group(1)}'."

    # ── Ziggy identity ────────────────────────────────────────────────────────
    if _P_ZIGGY_ID.match(text):
        return "אני זיגי, נבנה על ידי יובל כדי להפוך את הבית לחכם יותר."

    if _P_ZIGGY_STATUS.match(text):
        return "אני זיגי, העוזר הביתי שלך. עובד ומוכן לפקודות!"

    return None


_TRANSLATE_SYSTEM = "Translate the following smart home response to Hebrew. Return only the translation, nothing else."

# Splits multi-intent combined replies back into individual action strings.
# handle_intent joins multiple results as "A and B." or "A, B, and C."
_MULTI_SPLIT = re.compile(r',?\s+and\s+|\.\s+')


def _translate(text: str) -> str:
    """Translate a smart home response to Hebrew.

    Step 1a: instant pre-translated reply for single actions (zero latency).
    Step 1b: split multi-action reply and run each part through instant table —
             handles "Turning on bedroom light and Turning off office light."
             without any API call.
    Step 2:  Ollama local model (free, ~1s).
    Step 3:  GPT-4o-mini fallback (~2s, small cost).
    If the text is already Hebrew, returns it unchanged.
    """
    if is_hebrew(text):
        return text

    instant = _he_instant_reply(text)
    if instant:
        print("[Voice] Hebrew instant reply matched — no API call needed")
        return instant

    # Try splitting combined multi-intent reply and translating each part.
    # "Turning on X and Turning off Y." → ["Turning on X.", "Turning off Y."]
    parts = [p.strip() for p in _MULTI_SPLIT.split(text) if p.strip()]
    if len(parts) > 1:
        translated = []
        for part in parts:
            probe = part if part.endswith('.') else part + '.'
            t = _he_instant_reply(probe)
            if t:
                translated.append(t)
            else:
                translated = []
                break
        if translated:
            print(f"[Voice] Multi-part instant reply — {len(parts)} parts matched, no API call")
            return " ".join(translated)

    t0 = time.time()
    messages = [
        {"role": "system", "content": _TRANSLATE_SYSTEM},
        {"role": "user", "content": text},
    ]

    # --- Ollama path (local, free) ---
    try:
        from integrations.ollama_client import get_client as ollama_client, is_available, default_model
        if is_available():
            model = default_model()
            resp = ollama_client().chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=150,
                timeout=5,
            )
            result = (resp.choices[0].message.content or "").strip()
            # Require the response to be majority Hebrew, not just contain a stray character.
            he_chars = sum(1 for c in result if '֐' <= c <= 'ת')
            word_chars = sum(1 for c in result if c.isalpha())
            if he_chars > 0 and word_chars > 0 and he_chars / word_chars >= 0.5:
                print(f"[TIMING] translate-ollama ({model}): {time.time() - t0:.2f}s")
                return result
            print(f"[Voice] Ollama translation quality low (he={he_chars}/{word_chars}) — falling back to GPT")
    except Exception as e:
        print(f"[Voice] Ollama translation failed ({e}) — falling back to GPT")

    # --- GPT fallback ---
    try:
        from integrations.openai_client import get_client
        resp = get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=150,
            timeout=4,
        )
        result = resp.choices[0].message.content.strip()
        print(f"[TIMING] translate-gpt: {time.time() - t0:.2f}s")
        return result
    except Exception as e:
        print(f"[TIMING] translate: {time.time() - t0:.2f}s (FAILED: {e})")
        print(f"[Voice] Translation skipped ({e}) — returning English")
        return text

_NO_SPEECH_THRESHOLD = 0.80

# Languages this system supports. Anything else detected locally is treated as Hebrew
# (base Whisper sometimes confuses Hebrew with Arabic — both share similar phonetics).
_SUPPORTED_LANGS = frozenset({"en", "he"})


_MIN_AUDIO_BYTES = 1_000  # anything smaller is an empty/corrupt recording


def transcribe_web(audio_path: str) -> tuple[str, str]:
    """Fast STT for web push-to-talk via OpenAI Whisper API.

    - OpenAI API (whisper-1): ~1-2s for Hebrew and English with smart home prompt
    - prompt=_HE_INITIAL_PROMPT primes Whisper with home-automation vocabulary so
      it correctly transcribes 'כבה את האור' instead of 'חבא את האור'
    - Falls back to local transcribe() only on non-400 errors (network, auth, etc.)
      A 400 means the file itself is bad — local will fail the same way, so we skip.
    """
    # Guard: a very short or corrupt recording produces a tiny file that the API
    # rejects with HTTP 400. Bail early instead of paying for a failed call.
    try:
        file_size = os.path.getsize(audio_path)
    except OSError:
        file_size = 0
    if file_size < _MIN_AUDIO_BYTES:
        print(f"[STT] Audio too small ({file_size}B) — discarded")
        return "", "en"

    try:
        from integrations.openai_client import get_client
        t0 = time.time()
        with open(audio_path, "rb") as f:
            result = get_client().audio.transcriptions.create(
                model="whisper-1",
                file=f,
                # Vocabulary hint — dramatically improves accuracy for Hebrew
                # smart home commands (כבה/הדלק/מזגן/etc.) and prevents Whisper
                # from mishearing them as similar-sounding nonsense words.
                prompt=_HE_INITIAL_PROMPT,
            )
        text = (result.text or "").strip()
        # Determine language from character content — no extra model call needed.
        he_chars = sum(1 for c in text if '֐' <= c <= 'ת')
        lang = "he" if he_chars > max(1, len(text) * 0.1) else "en"
        print(f"[TIMING] whisper-api: {time.time() - t0:.2f}s, detected={lang!r}")
        return text, lang
    except Exception as e:
        err_str = str(e)
        # 400 = bad audio file — local model will fail the same way, don't retry.
        if "400" in err_str or "could not be decoded" in err_str or "not supported" in err_str:
            print(f"[STT] Whisper API rejected audio (bad format/too short) — discarded")
            return "", "en"
        print(f"[STT] Whisper API failed ({e}) — falling back to local transcribe()")
        return transcribe(audio_path)


def transcribe(audio_path: str):
    """
    Two-path local STT for standalone mic-based voice interface:
      English → local base Whisper (~1s)
      Hebrew  → local base detects language, ivrit-ai model transcribes locally
                fallback to OpenAI Whisper API if ivrit-ai model is unavailable

    For web push-to-talk use transcribe_web() instead — it's 10-20x faster.
    """
    t0 = time.time()
    model = _get_whisper()
    print(f"[TIMING] whisper model ready: {time.time() - t0:.2f}s")

    # Local base pass: language detection + English transcription.
    # beam_size=1 + temperature=0 (greedy) + vad_filter cuts 3-5s → ~0.5-1s for typical commands.
    t1 = time.time()
    segments_iter, info = model.transcribe(
        audio_path,
        beam_size=1,
        temperature=0,
        language=None,
        vad_filter=True,
        condition_on_previous_text=False,
        without_timestamps=True,
    )
    segments = list(segments_iter)
    raw_lang = (info.language or "en").lower()

    # Clamp to supported languages: base Whisper sometimes misidentifies Hebrew
    # as Arabic because they share similar phonetics. Anything that isn't English
    # is treated as Hebrew — this user only speaks the two.
    detected_lang = raw_lang if raw_lang in _SUPPORTED_LANGS else "he"
    if raw_lang != detected_lang:
        print(f"[STT] Language clamped: {raw_lang!r} → {detected_lang!r} (only he/en supported)")

    print(f"[TIMING] whisper detect: {time.time() - t1:.2f}s, detected={detected_lang!r}")

    # Silence check
    avg_no_speech = (
        sum(getattr(s, "no_speech_prob", 0.0) for s in segments) / len(segments)
        if segments else 1.0
    )
    print(f"[STT] no_speech_prob={avg_no_speech:.2f}")
    if avg_no_speech > _NO_SPEECH_THRESHOLD:
        print("[STT] Discarded — silence or noise")
        return "", "en"

    if detected_lang == "he":
        print("[STT] Hebrew detected — routing to local ivrit-ai model")
        return _transcribe_local_hebrew(audio_path)

    text = " ".join(s.text for s in segments).strip()
    print(f"[STT] lang={detected_lang!r}, segments={len(segments)}")
    return text, detected_lang

# ===== One-time mic calibration =====
_MIN_ENERGY_THRESHOLD = 200  # never go below this — prevents TV/background pickup

def _calibrate_mic():
    """Calibrate ambient noise once at startup — avoids cutting the first 400ms of every utterance."""
    print("[Voice] Calibrating microphone for ambient noise...")
    try:
        with sr.Microphone() as source:
            recognizer.adjust_for_ambient_noise(source, duration=2.0)
        # Enforce a floor so ambient TV/background doesn't trigger listening
        if recognizer.energy_threshold < _MIN_ENERGY_THRESHOLD:
            recognizer.energy_threshold = _MIN_ENERGY_THRESHOLD
        print(f"[Voice] Calibration done. Energy threshold: {recognizer.energy_threshold:.0f}")
    except Exception as e:
        print(f"[Voice] Calibration failed (continuing anyway): {e}")

# ===== TTS =====
_tts_guard_until = 0.0
_GTTS_LANG_MAP = {"he": "iw"}  # gTTS uses "iw" for Hebrew, not "he"


def _speak_azure(text: str, lang: str = "en") -> bool:
    """Speak using Azure Cognitive Services Neural TTS (REST API, no SDK needed).

    Requires AZURE_SPEECH_KEY in settings.yaml voice.azure.speech_key or env var.
    Returns True if audio played successfully.
    """
    if not _AZURE_KEY:
        return False
    import html
    import requests as _req

    voice    = _AZURE_VOICE_HE if lang == "he" else _AZURE_VOICE_EN
    xml_lang = "he-IL" if lang == "he" else "en-US"
    safe     = html.escape(text)
    ssml = (
        f"<speak version='1.0' xml:lang='{xml_lang}' "
        f"xmlns='http://www.w3.org/2001/10/synthesis'>"
        f"<voice name='{voice}'>{safe}</voice></speak>"
    )
    url     = f"https://{_AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": _AZURE_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
    }
    out_path = None
    try:
        t0   = time.time()
        resp = _req.post(url, headers=headers, data=ssml.encode("utf-8"), timeout=10)
        if resp.status_code != 200:
            print(f"[Voice] Azure TTS HTTP {resp.status_code}: {resp.text[:200]}")
            return False
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as fp:
            fp.write(resp.content)
            out_path = fp.name
        print(f"[TIMING] azure-tts: {time.time() - t0:.2f}s")
        playsound.playsound(out_path)
        return True
    except Exception as e:
        print(f"[Voice] Azure TTS error: {e}")
        return False
    finally:
        if out_path:
            try:
                os.unlink(out_path)
            except Exception:
                pass


def _speak_piper(text: str, lang: str = "en") -> bool:
    """Speak using local Piper TTS. Returns True if successful."""
    voice = _PIPER_VOICE_HE if lang == "he" and _PIPER_VOICE_HE.exists() else _PIPER_VOICE
    if _PIPER_EXE is None or not voice.exists():
        return False
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as fp:
            out_path = fp.name
        cmd = [_PIPER_EXE, "-m", str(voice), "-f", out_path]
        proc = subprocess.run(cmd, input=text.encode("utf-8"), capture_output=True, timeout=15)
        if proc.returncode != 0:
            if is_verbose():
                print("[Voice] Piper stderr:", proc.stderr.decode("utf-8", "ignore"))
            return False
        playsound.playsound(out_path)
        return True
    except Exception as e:
        print(f"[Voice] Piper TTS error: {e}")
        return False
    finally:
        if out_path:
            try:
                os.unlink(out_path)
            except Exception:
                pass

import re as _re
_ENTITY_ID_RE = _re.compile(
    r"\b[a-z_]+\.[a-z0-9_]{3,}\b",  # matches HA entity IDs like binary_sensor.office_motion
    _re.ASCII,
)

def _clean_for_tts(text: str, lang: str) -> str:
    """Strip or simplify content that sounds bad when spoken aloud.

    For Hebrew TTS specifically: HA entity IDs like binary_sensor.office_motion
    will be mispronounced badly. Replace them with a brief placeholder.
    For English TTS the same entity IDs are at least pronounceable, so skip it.
    """
    if lang != "he":
        return text
    # Replace entity IDs with "the sensor" / "the device" in Hebrew
    def _replace_entity(m: _re.Match) -> str:
        eid = m.group(0)
        if eid.startswith("binary_sensor.") or eid.startswith("sensor."):
            return "החיישן"
        if eid.startswith("light."):
            return "האור"
        if eid.startswith("climate."):
            return "המזגן"
        if eid.startswith("media_player."):
            return "הטלוויזיה"
        if eid.startswith("switch."):
            return "המתג"
        return "המכשיר"
    return _ENTITY_ID_RE.sub(_replace_entity, text)


def speak(text: str, lang: str = "en"):
    global _tts_guard_until
    try:
        text = _clean_for_tts(text, lang)
        if is_verbose():
            print(f"[Voice] Speaking ({lang}): {text}")
        est_sec = max(1.0, len(text.split()) / 2.3 + 0.6)
        _tts_guard_until = time.time() + est_sec

        # Azure Neural TTS — best quality, requires API key
        if TTS_ENGINE == "azure" and _speak_azure(text, lang=lang):
            if is_verbose():
                print("[Voice] Azure TTS used.")
            return

        # Piper — local, no internet; Hebrew voice used if available
        if TTS_ENGINE != "azure" and _speak_piper(text, lang=lang):
            if is_verbose():
                print("[Voice] Piper TTS used.")
            return

        # gTTS fallback — works for Hebrew and any other language
        tts = gTTS(text=text, lang=_GTTS_LANG_MAP.get(lang, lang))
        filename = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}.mp3")
        tts.save(filename)
        playsound.playsound(filename)
        if is_verbose():
            print("[Voice] gTTS fallback used.")
    except Exception as e:
        print("[Voice] TTS Error:", e)
        _tts_guard_until = time.time() + 0.8

# ===== Intent pipeline (sync wrapper) =====
def _handle_intent_sync(text: str):
    try:
        t0 = time.time()
        intent_data = quick_parse(text)
        print(f"[TIMING] quick_parse: {time.time() - t0:.2f}s → intent={intent_data.get('intent')}")
        intent_data["source"] = "voice"
        t1 = time.time()
        result = asyncio.run(handle_intent(intent_data))
        print(f"[TIMING] handle_intent: {time.time() - t1:.2f}s")
        return result
    except Exception as e:
        print(f"[Voice] Intent handling error: {e}")
        return {"ok": False, "message": "Sorry, something went wrong.", "data": {}}


def _handle_chat_sync(text: str) -> dict:
    """Chat mode: try whitelisted info intents first, then fall back to GPT conversation."""
    try:
        parsed = quick_parse(text)
        parsed["source"] = "voice"

        if parsed.get("intent") in CHAT_ALLOWED_INTENTS:
            return asyncio.run(handle_intent(parsed))

        # Pure GPT conversation with session-scoped history.
        append_voice_chat("user", text)
        chat_history = get_voice_chat_history()
        intent_data = {
            "intent": "chat_with_gpt",
            "params": {"text": text, "chat_history": chat_history},
            "source": "voice",
        }
        result = asyncio.run(handle_intent(intent_data))
        reply = render_result(result)
        if reply:
            append_voice_chat("assistant", reply)
        return result
    except Exception as e:
        print(f"[Voice] Chat mode error: {e}")
        return {"ok": False, "message": "Sorry, something went wrong.", "data": {}}

# ===== Wake engines init =====
wake_engine = None
wakeword_model = None
wake_key = None
porcupine = None

OWW_AVAILABLE = False
OWWModel = None
OWWLegacy = None
try:
    from openwakeword import Model as OWWModel
    OWW_AVAILABLE = True
except Exception:
    pass
if not OWW_AVAILABLE:
    try:
        from openwakeword.model import Model as OWWLegacy
        OWW_AVAILABLE = True
    except Exception:
        pass

PORCUPINE_AVAILABLE = False
try:
    import pvporcupine
    PORCUPINE_AVAILABLE = True
except Exception:
    pass

if WAKEWORD_ENABLED:
    if WAKEWORD_ENGINE == "oww" and OWW_AVAILABLE:
        try:
            if OWWModel is not None:
                # inference_framework="onnx" avoids tflite-runtime which isn't available on Windows Python 3.11+
                wakeword_model = OWWModel(
                    wakeword_models=[WAKEWORD_MODEL_NAME],
                    inference_framework="onnx",
                )
                wake_key = os.path.splitext(os.path.basename(WAKEWORD_MODEL_NAME))[0] or WAKEWORD_MODEL_NAME
            elif OWWLegacy is not None:
                wakeword_model = OWWLegacy(provider="onnx", model_name=WAKEWORD_MODEL_NAME)
                wake_key = "hey_mycroft"
            else:
                raise RuntimeError("No OWW class available")
            wake_engine = "oww"
            print(f"[Voice] OpenWakeWord initialized. Model: {WAKEWORD_MODEL_NAME}, key: {wake_key}")
        except Exception as e:
            print(f"[Voice] OpenWakeWord init failed: {e}")

    if wake_engine is None and WAKEWORD_ENGINE == "porcupine" and PORCUPINE_AVAILABLE:
        try:
            kw_is_path = str(PORCUPINE_KEYWORD).lower().endswith(".ppn")
            kwargs = {}
            if PORCUPINE_ACCESS_KEY:
                kwargs["access_key"] = PORCUPINE_ACCESS_KEY
            if kw_is_path:
                kwargs["keyword_paths"] = [PORCUPINE_KEYWORD]
            else:
                kwargs["keywords"] = [PORCUPINE_KEYWORD]
            porcupine = pvporcupine.create(**kwargs)
            wake_engine = "porcupine"
            WW_SAMPLE_RATE = porcupine.sample_rate
            WW_BLOCK_SIZE = porcupine.frame_length
            print(f"[Voice] Porcupine initialized. Keyword: {PORCUPINE_KEYWORD}")
        except Exception as e:
            print(f"[Voice] Porcupine init failed: {e}")

    if wake_engine is None:
        print("[Voice] Wakeword requested but no engine could be initialized; falling back to always-listen.")
        WAKEWORD_ENABLED = False


def start_voice_interface():
    print("[Voice] Wake-word mode enabled..." if WAKEWORD_ENABLED else "[Voice] Always-listen mode enabled...")

    # Calibrate once so we don't eat the first 400ms of every utterance
    _calibrate_mic()

    ww_stream = None
    cooldown_until = 0.0
    hits_window = deque(maxlen=WAKEWORD_HITS)
    oww_buffer = np.zeros((WW_SAMPLE_RATE * 2,), dtype=np.float32) if WAKEWORD_ENABLED else None

    def start_wake_stream():
        if not WAKEWORD_ENABLED:
            return None
        try:
            s = sd.InputStream(
                samplerate=WW_SAMPLE_RATE,
                channels=1,
                blocksize=WW_BLOCK_SIZE,
                dtype='float32'
            )
            s.start()
            return s
        except Exception as e:
            print(f"[Voice] Could not start wake-word stream: {e}")
            return None

    def stop_wake_stream(s):
        try:
            if s is not None:
                s.stop()
                s.close()
        except Exception:
            pass

    is_active = not WAKEWORD_ENABLED
    last_active_time = 0

    if WAKEWORD_ENABLED:
        ww_stream = start_wake_stream()

    while True:
        # ===== Wake-word detection =====
        if WAKEWORD_ENABLED and not is_active and ww_stream is not None:
            try:
                block, _ = ww_stream.read(WW_BLOCK_SIZE)
                now = time.time()
                if now < _tts_guard_until or now < cooldown_until:
                    continue

                if wake_engine == "oww" and wakeword_model is not None and oww_buffer is not None:
                    oww_buffer = np.roll(oww_buffer, -WW_BLOCK_SIZE)
                    oww_buffer[-WW_BLOCK_SIZE:] = block[:, 0]
                    preds = wakeword_model.predict(oww_buffer)
                    score = preds.get(wake_key, 0.0) if isinstance(preds, dict) else 0.0
                    hits_window.append(score >= WAKEWORD_THRESHOLD)
                    should_trigger = (len(hits_window) == WAKEWORD_HITS and all(hits_window))

                elif wake_engine == "porcupine" and porcupine is not None:
                    pcm = np.clip(block[:, 0] * 32768.0, -32768, 32767).astype(np.int16)
                    result = porcupine.process(pcm)
                    should_trigger = (result >= 0)
                else:
                    should_trigger = False

                if should_trigger:
                    print("[Voice] Wake word detected. Entering conversation mode...")
                    reset_voice_session()
                    speak("Yes?")
                    is_active = True
                    last_active_time = now
                    cooldown_until = now + (WAKEWORD_COOLDOWN_MS / 1000.0)
                    hits_window.clear()
                    stop_wake_stream(ww_stream)
                    ww_stream = None
                    continue

            except Exception as e:
                print(f"[Voice] Wakeword error: {e}")
                time.sleep(0.05)
                continue

        # ===== Active conversation =====
        if is_active:
            try:
                with sr.Microphone() as source:
                    print("[Voice] Listening...")
                    audio = recognizer.listen(source, timeout=10, phrase_time_limit=12)
                    print("[Voice] Processing...")

                _t_audio_end = time.time()

                t_wav0 = time.time()
                with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as fp:
                    fp.write(audio.get_wav_data())
                    fp.flush()
                    _wav_path = fp.name
                print(f"[TIMING] wav write: {time.time() - t_wav0:.2f}s")

                t_stt0 = time.time()
                transcription, detected_lang = transcribe(_wav_path)
                print(f"[TIMING] stt total: {time.time() - t_stt0:.2f}s")

                if not transcription.strip():
                    print("[STT] Empty transcription — discarded")
                else:
                    lang_tag = "[HE]" if detected_lang == "he" else "[EN]"
                    print(f"[Voice] You said {lang_tag}: {fix_hebrew_direction(transcription)}")
                    last_active_time = time.time()

                    tl = transcription.lower()
                    if "enable debug" in tl or "enable verbose" in tl:
                        toggle_verbose(True)
                        speak("Verbose debug mode enabled.")
                        continue
                    if "disable debug" in tl or "disable verbose" in tl:
                        toggle_verbose(False)
                        speak("Verbose debug mode disabled.")
                        continue
                    if any(kw in tl for kw in ["exit", "shutdown", "ziggy off", "quit", "close"]):
                        print("[Voice] Shutdown command recognized.")
                        speak("Shutting down.")
                        os._exit(0)

                    pipeline_text = transcription
                    reply_lang = detected_lang

                    # === Session mode: trigger phrase detection ===
                    tl_stripped = transcription.strip().lower()
                    if is_chat_trigger(tl_stripped):
                        set_voice_mode(MODE_CHAT)
                        speak(get_response("chat_mode_entered", reply_lang), lang=reply_lang)
                        continue
                    if is_command_trigger(tl_stripped):
                        set_voice_mode(MODE_COMMAND)
                        speak(get_response("chat_mode_exited", reply_lang), lang=reply_lang)
                        continue

                    # === Route by mode ===
                    t_intent0 = time.time()
                    if get_voice_mode() == MODE_CHAT:
                        result = _handle_chat_sync(pipeline_text)
                    else:
                        result = _handle_intent_sync(pipeline_text)
                    print(f"[TIMING] intent+action: {time.time() - t_intent0:.2f}s")

                    t_render0 = time.time()
                    reply = render_result(result)
                    print(f"[TIMING] render: {time.time() - t_render0:.3f}s")

                    if reply_lang == "he":
                        t_tr0 = time.time()
                        reply = _translate(reply)
                        print(f"[TIMING] translate (logged inside too): {time.time() - t_tr0:.2f}s")
                        if is_verbose():
                            print(f"[Voice] Translated reply (en→he): {reply}")

                    lang_tag = "[HE]" if reply_lang == "he" else "[EN]"
                    print(f"[Ziggy] {lang_tag}: {fix_hebrew_direction(reply)}")

                    t_tts0 = time.time()
                    speak(reply, lang=reply_lang)
                    print(f"[TIMING] tts+play: {time.time() - t_tts0:.2f}s")

                    print(f"[TIMING] total end-to-end (audio captured → done): {time.time() - _t_audio_end:.2f}s")

            except sr.WaitTimeoutError:
                print(f"[Voice] No speech detected (threshold={recognizer.energy_threshold:.0f}). Speak louder or say 'enable debug'.")
            except Exception as e:
                print(f"[Voice] Error during conversation: {e}")

            if time.time() - last_active_time > ACTIVE_CONVERSATION_TIMEOUT:
                if WAKEWORD_ENABLED:
                    print("[Voice] No speech for a while. Returning to wake-word mode.")
                is_active = not WAKEWORD_ENABLED
                if WAKEWORD_ENABLED and ww_stream is None:
                    ww_stream = start_wake_stream()
                time.sleep(0.2)
