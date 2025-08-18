import os
import tempfile
import uuid
import time
import asyncio
import numpy as np
import sounddevice as sd
import speech_recognition as sr
from gtts import gTTS
import playsound
from faster_whisper import WhisperModel
from openwakeword.model import Model

from core.settings_loader import settings
from services.debug_control import is_verbose, toggle_verbose
from core.intent_parser import quick_parse
from core.action_parser import handle_intent
from core.result_utils import render_result

# Initialize models
recognizer = sr.Recognizer()
model = WhisperModel("tiny", compute_type="int8")
wakeword_enabled = settings["voice"].get("wakeword_enabled", False)
if wakeword_enabled:
    wakeword_model = Model(provider="onnx", model_name="hey_mycroft.onnx")

# Constants
SAMPLE_RATE = 16000
BLOCK_SIZE = 512
ACTIVE_CONVERSATION_TIMEOUT = 120  # seconds

def is_hebrew(text: str) -> bool:
    return any('\u0590' <= c <= '\u05EA' for c in text or "")

def fix_hebrew_direction(text: str) -> str:
    words = (text or "").split()
    return " ".join(word[::-1] if is_hebrew(word) else word for word in words)

def transcribe(audio_path: str):
    segments, _ = model.transcribe(audio_path, beam_size=5, language="en")
    text = " ".join(seg.text for seg in segments).strip()
    if is_verbose():
        print("[Debug] English:", text)
    return text, "en"

def speak(text: str, lang: str = 'en'):
    try:
        if is_verbose():
            print(f"[Voice] Speaking ({lang}): {text}")
        tts = gTTS(text=text, lang=lang)
        filename = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}.mp3")
        tts.save(filename)
        playsound.playsound(filename)
        if is_verbose():
            print("[Voice] TTS played successfully")
    except Exception as e:
        print("[Voice] TTS Error:", e)

def _handle_intent_sync(text: str) -> str:
    """
    Parse -> handle -> render. Runs the async handler in a fresh event loop for this thread.
    """
    try:
        intent_data = quick_parse(text)
        intent_data["source"] = "voice"
        # Run async in this thread
        return asyncio.run(handle_intent(intent_data))  # returns dict or str
    except Exception as e:
        print(f"[Voice] Intent handling error: {e}")
        return {"ok": False, "message": "Sorry, something went wrong.", "data": {}}

def start_voice_interface():
    print("[Voice] Wake-word mode enabled..." if wakeword_enabled else "[Voice] Always-listen mode enabled...")

    stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, blocksize=BLOCK_SIZE, dtype='float32')
    stream.start()

    is_active = not wakeword_enabled  # if no wakeword, stay active
    last_active_time = 0
    buffer = np.zeros((SAMPLE_RATE * 2,), dtype=np.float32)  # 2-second buffer

    while True:
        block, _ = stream.read(BLOCK_SIZE)
        buffer = np.roll(buffer, -BLOCK_SIZE)
        buffer[-BLOCK_SIZE:] = block[:, 0]

        if wakeword_enabled and not is_active:
            try:
                prediction = wakeword_model.predict(buffer)
                if prediction.get("hey_mycroft", 0) > 0.5:
                    print("[Voice] Wake word detected. Entering conversation mode...")
                    speak("Yes?")
                    is_active = True
                    last_active_time = time.time()
                continue
            except Exception as e:
                print(f"[Voice] Wakeword error: {e}")
                # Fall back to active listen if wakeword fails
                is_active = True

        # Active conversation mode
        try:
            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.5)
                if is_verbose():
                    print("[Voice] Listening...")
                audio = recognizer.listen(source, timeout=10, phrase_time_limit=8)

            with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as fp:
                fp.write(audio.get_wav_data())
                fp.flush()
                transcription, lang = transcribe(fp.name)

            if not transcription.strip():
                continue

            print(f"[Voice] You said: {transcription}")
            last_active_time = time.time()

            # Internal debug toggles
            text_lower = transcription.lower()
            if "enable debug" in text_lower or "enable verbose" in text_lower:
                toggle_verbose(True)
                speak("Verbose debug mode enabled.")
                continue
            if "disable debug" in text_lower or "disable verbose" in text_lower:
                toggle_verbose(False)
                speak("Verbose debug mode disabled.")
                continue
            if any(kw in text_lower for kw in ["exit", "shutdown", "ziggy off", "quit", "close"]):
                print("[Voice] Shutdown command recognized.")
                speak("Shutting down.")
                os._exit(0)

            # Intent pipeline
            result = _handle_intent_sync(transcription)
            reply = render_result(result)
            print(f"[Ziggy] {reply}")
            speak(fix_hebrew_direction(reply) if is_hebrew(reply) else reply, lang="he" if is_hebrew(reply) else "en")

        except sr.WaitTimeoutError:
            pass
        except Exception as e:
            print(f"[Voice] Error during conversation: {e}")

        # Timeout to revert back to wake-word mode
        if is_active and (time.time() - last_active_time > ACTIVE_CONVERSATION_TIMEOUT):
            print("[Voice] No speech for a while. Returning to wake-word mode.")
            is_active = not wakeword_enabled  # if wakeword enabled, go inactive; else stay active
