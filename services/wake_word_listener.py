import pvporcupine
import pyaudio
import struct
import time

def listen_for_wake_word(keyword="ziggy", on_detected=None):
    porcupine = pvporcupine.create(keywords=[keyword])
    pa = pyaudio.PyAudio()
    stream = pa.open(
        rate=porcupine.sample_rate,
        channels=1,
        format=pyaudio.paInt16,
        input=True,
        frames_per_buffer=porcupine.frame_length,
    )

    print("[WakeWord] Listening for wake word...")

    try:
        while True:
            pcm = stream.read(porcupine.frame_length, exception_on_overflow=False)
            pcm = struct.unpack_from("h" * porcupine.frame_length, pcm)

            if porcupine.process(pcm) >= 0:
                print("[WakeWord] Wake word detected!")
                if on_detected:
                    on_detected()
                break  # Exit and allow full interaction
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
        porcupine.delete()
