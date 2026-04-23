# interfaces/voice_interface.py

import os
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

# ===== Settings / Config =====
VOICE_CFG = settings.get("voice", {})
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
whisper_model = WhisperModel("base", compute_type="int8")

# ===== Piper TTS =====
_REPO_ROOT = Path(__file__).parent.parent
_PIPER_EXE = shutil.which("piper") or shutil.which("piper.exe")
_PIPER_VOICE = _REPO_ROOT / "piper_voices" / "en_US-libritts_r-medium.onnx"

# ===== Hebrew helpers =====
def is_hebrew(text: str) -> bool:
    return any('\u0590' <= c <= '\u05EA' for c in text or "")

def fix_hebrew_direction(text: str) -> str:
    words = (text or "").split()
    return " ".join(word[::-1] if is_hebrew(word) else word for word in words)

def _translate(text: str, to_lang: str) -> str:
    """Translate text to 'en' or 'he' via gpt-4o-mini. Source language is auto-detected."""
    try:
        from integrations.openai_client import get_client
        if to_lang == "en":
            system = "Translate the following text to English. Return only the translation, nothing else."
        else:
            system = "Translate the following text to Hebrew. Return only the translation, nothing else."
        resp = get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
            max_tokens=300,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        print(f"[Voice] Translation error: {e}")
        return text

def _stt_language_arg():
    if STT_LANGUAGE in ("", "auto", "autodetect"):
        return None
    return STT_LANGUAGE

_NO_SPEECH_EN = 0.80
_NO_SPEECH_HE = 0.95  # Hebrew: Whisper is less confident, be very permissive

def transcribe(audio_path: str):
    # First pass: auto-detect
    segments_iter, info = whisper_model.transcribe(audio_path, beam_size=5, language=_stt_language_arg())
    segments = list(segments_iter)
    detected = (info.language or "en").lower()

    print(f"[STT] Auto-detect: lang={detected!r}, segments={len(segments)}")

    if detected == "en":
        # Confirmed English — use as-is
        lang = "en"
    else:
        # Anything non-English (he, ar, fr, de, …) → retry forced as Hebrew.
        # Whisper frequently mislabels Hebrew as Arabic, French, German, etc.
        print(f"[STT] Non-English ({detected!r}) → retrying as Hebrew")
        segs2, _ = whisper_model.transcribe(audio_path, beam_size=5, language="he")
        segments = list(segs2)
        detected = "he"
        lang = "he"
        print(f"[STT] Hebrew re-pass: {len(segments)} segments")

    # Filter silence / pure noise
    if segments:
        avg_no_speech = sum(getattr(s, "no_speech_prob", 0.0) for s in segments) / len(segments)
    else:
        avg_no_speech = 1.0

    threshold = _NO_SPEECH_HE if lang == "he" else _NO_SPEECH_EN
    print(f"[STT] no_speech_prob={avg_no_speech:.2f} (threshold={threshold})")

    if avg_no_speech > threshold:
        print("[STT] Discarded — silence or noise")
        return "", "en"

    text = " ".join(s.text for s in segments).strip()
    return text, lang

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

def _speak_piper(text: str) -> bool:
    """Speak using local Piper TTS. Returns True if successful."""
    if _PIPER_EXE is None or not _PIPER_VOICE.exists():
        return False
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as fp:
            out_path = fp.name
        cmd = [_PIPER_EXE, "-m", str(_PIPER_VOICE), "-f", out_path]
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

def speak(text: str, lang: str = "en"):
    global _tts_guard_until
    try:
        if is_verbose():
            print(f"[Voice] Speaking ({lang}): {text}")
        est_sec = max(1.0, len(text.split()) / 2.3 + 0.6)
        _tts_guard_until = time.time() + est_sec

        # Piper is English-only — fast, local, no internet
        if lang == "en" and _speak_piper(text):
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
        intent_data = quick_parse(text)
        intent_data["source"] = "voice"
        return asyncio.run(handle_intent(intent_data))
    except Exception as e:
        print(f"[Voice] Intent handling error: {e}")
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

                with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as fp:
                    fp.write(audio.get_wav_data())
                    fp.flush()
                    transcription, detected_lang = transcribe(fp.name)

                if not transcription.strip():
                    print("[STT] Empty transcription — discarded")
                else:
                    lang_tag = "[HE]" if detected_lang == "he" else "[EN]"
                    print(f"[Voice] You said {lang_tag}: {transcription}")
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

                    # Non-English: translate to English for pipeline, reply in Hebrew
                    # (Whisper may return "ar" for Hebrew speech — treat both as Hebrew)
                    pipeline_text = transcription
                    reply_lang = detected_lang
                    if detected_lang != "en":
                        reply_lang = "he"
                        pipeline_text = _translate(transcription, "en")
                        if is_verbose():
                            print(f"[Voice] Translated ({detected_lang}→en): {pipeline_text}")

                    result = _handle_intent_sync(pipeline_text)
                    reply = render_result(result)

                    if reply_lang == "he":
                        reply = _translate(reply, "he")
                        if is_verbose():
                            print(f"[Voice] Translated reply (en→he): {reply}")

                    lang_tag = "[HE]" if reply_lang == "he" else "[EN]"
                    print(f"[Ziggy] {lang_tag}: {reply}")
                    speak(reply, lang=reply_lang)

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
