import speech_recognition as sr
from gtts import gTTS
import os
import tempfile
import uuid
import subprocess
from faster_whisper import WhisperModel
from datetime import datetime
import openai
from core.settings_loader import settings

recognizer = sr.Recognizer()
model = WhisperModel("tiny", compute_type="int8")
openai.api_key = settings["openai"]["api_key"]

def is_hebrew(text):
    return any('\u0590' <= c <= '\u05EA' for c in text)

def fix_hebrew_direction(text):
    words = text.split()
    return " ".join(word[::-1] if is_hebrew(word) else word for word in words)

def transcribe(audio_path):
    segments, _ = model.transcribe(audio_path, beam_size=5, language="en")
    text = " ".join(seg.text for seg in segments).strip()
    print("[Debug] English:", text)
    return text, "en"

def speak(text, lang='en'):
    try:
        tts = gTTS(text=text, lang=lang)
        filename = os.path.join(tempfile.gettempdir(), f"ziggy_tts_{uuid.uuid4().hex}.mp3")
        tts.save(filename)

        ffplay_path = settings["audio"]["ffplay_path"]
        subprocess.run(
            [ffplay_path, "-nodisp", "-autoexit", "-loglevel", "quiet", filename],
            shell=True
        )
    except Exception as e:
        print("[Voice] TTS Error:", e)
    finally:
        try:
            if 'filename' in locals() and os.path.exists(filename):
                os.remove(filename)
        except Exception:
            pass

def generate_ziggy_response(transcription):
    try:
        print("[GPT] Sending to OpenAI:", transcription)
        completion = openai.ChatCompletion.create(
            model="gpt-4",
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
        print("[GPT] Response:", reply)
        return reply
    except Exception as e:
        print("[GPT] Error:", e)
        return "Sorry, I had trouble thinking of a reply."

def start_voice_interface():
    print("[Voice] Listening...")
    with sr.Microphone() as source:
        while True:
            try:
                audio = recognizer.listen(source, timeout=10, phrase_time_limit=8)
                with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as fp:
                    fp.write(audio.get_wav_data())
                    fp.flush()
                    transcription, lang = transcribe(fp.name)
                    text_lower = transcription.lower()
                    print(f"[Voice] You said: {transcription}")
                    print(f"[Voice] Language: {lang}")
                    print(f"[Voice] (lowercased): {text_lower}")

                    if lang != 'en':
                        print(f"[Voice] Ignoring unsupported language: {lang}")
                        continue

                    shutdown_keywords = [
                        "exit", "shutdown", "shut down", "stop", "quit", "close", "ziggy off"
                    ]
                    if any(kw in text_lower for kw in shutdown_keywords):
                        print("[Voice] Shutdown command recognized. Exiting Ziggy.")
                        speak("Shutting down.", lang='en')
                        os._exit(0)

                    response = generate_ziggy_response(transcription)
                    print(f"[Ziggy] {response}")
                    speak(response, lang='en')

            except sr.WaitTimeoutError:
                print("[Voice] Error: listening timed out while waiting for phrase to start")
            except Exception as e:
                print("[Voice] Error:", e)