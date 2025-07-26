import os
import tempfile
import uuid
import time
import numpy as np
import sounddevice as sd
import speech_recognition as sr
from gtts import gTTS
import playsound
import openai
from faster_whisper import WhisperModel
from openwakeword.model import Model
from core.settings_loader import settings
from services.debug_control import is_verbose, toggle_verbose

# Initialize models
recognizer = sr.Recognizer()
model = WhisperModel("tiny", compute_type="int8")
if settings["voice"].get("wakeword_enabled", False):
    wakeword_model = Model(provider="onnx", model_name="hey_mycroft.onnx")
openai.api_key = settings["openai"]["api_key"]


# Constants
SAMPLE_RATE = 16000
BLOCK_SIZE = 512
ACTIVE_CONVERSATION_TIMEOUT = 120  # seconds

def is_hebrew(text):
    return any('\u0590' <= c <= '\u05EA' for c in text)

def fix_hebrew_direction(text):
    words = text.split()
    return " ".join(word[::-1] if is_hebrew(word) else word for word in words)

def transcribe(audio_path):
    segments, _ = model.transcribe(audio_path, beam_size=5, language="en")
    text = " ".join(seg.text for seg in segments).strip()
    if is_verbose():
        print("[Debug] English:", text)
    return text, "en"

def speak(text, lang='en'):
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

def generate_ziggy_response(transcription):
    try:
        if is_verbose():
            print("[GPT] Sending to OpenAI:", transcription)
        start_time = time.time()
        completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Ziggy, a smart home AI assistant created by Youval. "
                        "You run on a personal computer and respond to both voice and Telegram commands. "
                        "You can control devices, answer questions, manage tasks, and engage in natural conversation. "
                        "Keep responses clear, concise, and helpful. Use a friendly and confident tone, and avoid sounding robotic. "
                        "You don’t remember anything between sessions unless explicitly told to."
                    )
                },
                {"role": "user", "content": transcription}
            ],
            temperature=0.7,
            max_tokens=100
        )
        reply = completion.choices[0].message["content"].strip()
        if is_verbose():
            print(f"[GPT] Response: {reply} (in {time.time() - start_time:.2f}s)")
        return reply
    except Exception as e:
        print("[GPT] Error:", e)
        return "Sorry, I had trouble thinking of a reply."

def start_voice_interface():
    print("[Voice] Wake-word mode enabled...")

    stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, blocksize=BLOCK_SIZE, dtype='float32')
    stream.start()

    is_active = False
    last_active_time = 0
    buffer = np.zeros((SAMPLE_RATE * 2,), dtype=np.float32)  # 2-second buffer

    while True:
        block, _ = stream.read(BLOCK_SIZE)
        buffer = np.roll(buffer, -BLOCK_SIZE)
        buffer[-BLOCK_SIZE:] = block[:, 0]

        if not is_active:
            prediction = wakeword_model.predict(buffer)
            if prediction.get("hey_mycroft", 0) > 0.5:
                print("[Voice] Wake word detected. Entering conversation mode...")
                speak("Yes?")
                is_active = True
                last_active_time = time.time()
            continue

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
            text_lower = transcription.lower()

            # Handle internal commands
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

            response = generate_ziggy_response(transcription)
            print(f"[Ziggy] {response}")
            speak(response)

        except sr.WaitTimeoutError:
            pass
        except Exception as e:
            print(f"[Voice] Error during conversation: {e}")

        # Timeout to revert back to wake-word mode
        if time.time() - last_active_time > ACTIVE_CONVERSATION_TIMEOUT:
            print("[Voice] No speech for a while. Returning to wake-word mode.")
            is_active = False
