#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Record wake word samples from your microphone.

Say 'היי זיגי' (or 'Hey Ziggy') 40 times into the mic.
Each recording is saved as a 16 kHz mono WAV, ready for OWW training
or upload to Picovoice Console (Porcupine custom wake word).

Usage:
  python record_hey_ziggy.py                         # 40 samples, 2s each
  python record_hey_ziggy.py --count 60 --dur 2.5    # more samples, longer window
  python record_hey_ziggy.py --phrase "Hey Ziggy"    # English phrase variant
  python record_hey_ziggy.py --list-devices           # show available input devices

Requirements:
  pip install sounddevice soundfile numpy
"""
import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np

try:
    import sounddevice as sd
    import soundfile as sf
except ImportError:
    print("[!] Missing dependency. Run:  pip install sounddevice soundfile numpy")
    sys.exit(1)

TARGET_SR = 16000
CHANNELS  = 1


def list_devices():
    print("\nAvailable audio input devices:\n")
    devices = sd.query_devices()
    for i, d in enumerate(devices):
        if d["max_input_channels"] > 0:
            marker = "  *" if i == sd.default.device[0] else "   "
            print(f"{marker} [{i}] {d['name']}")
    print(f"\n  * = default input device\n")


def beep(freq: int = 880, dur: float = 0.12):
    t    = np.linspace(0, dur, int(TARGET_SR * dur), endpoint=False)
    tone = (0.28 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    sd.play(tone, TARGET_SR)
    sd.wait()


def record_sample(dur: float, device=None) -> np.ndarray:
    n     = int(TARGET_SR * dur)
    audio = sd.rec(n, samplerate=TARGET_SR, channels=CHANNELS, dtype="float32", device=device)
    sd.wait()
    return audio[:, 0]


def main():
    ap = argparse.ArgumentParser(
        description="Record wake word samples from microphone."
    )
    ap.add_argument("--count",        type=int,   default=40,        help="Number of samples (default: 40)")
    ap.add_argument("--dur",          type=float, default=2.0,        help="Seconds per sample (default: 2.0)")
    ap.add_argument("--out",          type=str,   default="oww_data", help="Output root directory")
    ap.add_argument("--phrase",       type=str,   default="היי זיגי", help="Phrase shown as prompt")
    ap.add_argument("--device",       type=int,   default=None,       help="Input device index (see --list-devices)")
    ap.add_argument("--list-devices", action="store_true",             help="List input devices and exit")
    args = ap.parse_args()

    if args.list_devices:
        list_devices()
        return

    out_dir = Path(args.out) / "hey_ziggy" / "positives"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Find next index so we don't overwrite existing samples
    existing = sorted(out_dir.glob("mic_*.wav"))
    start_idx = 1
    if existing:
        last = int(existing[-1].stem.split("_")[-1])
        start_idx = last + 1

    phrase = args.phrase
    print(f"\n🎙️  Recording '{phrase}' — {args.count} samples × {args.dur}s")
    print(f"   Saving to: {out_dir}")
    print(f"\n   HOW IT WORKS:")
    print(f"   ▸ LOW beep  → get ready")
    print(f"   ▸ HIGH beep → say '{phrase}' NOW")
    print(f"   ▸ Recording stops after {args.dur}s automatically")
    print(f"\n   Press Enter to start, Ctrl+C to stop early.\n")

    input("   [Enter to start]")

    recorded = 0
    end_idx  = start_idx + args.count

    try:
        for idx in range(start_idx, end_idx):
            n = recorded + 1
            print(f"\n  [{n}/{args.count}]  Get ready…", end="", flush=True)
            beep(440)        # low beep = prepare
            time.sleep(0.6)
            print(f"  SAY IT →", end=" ", flush=True)
            beep(880)        # high beep = record now
            audio = record_sample(args.dur, device=args.device)

            # Basic quality check: discard if near-silent
            rms = float(np.sqrt(np.mean(audio ** 2)))
            if rms < 0.002:
                print(f"⚠  Too quiet (rms={rms:.4f}) — try speaking louder. Retrying this slot.")
                end_idx += 1   # add a retry slot
                continue

            out_path = out_dir / f"mic_{idx:04d}.wav"
            sf.write(str(out_path), audio, TARGET_SR)
            print(f"✓  {out_path.name}  (rms={rms:.3f})")
            recorded += 1
            time.sleep(0.35)

    except KeyboardInterrupt:
        print(f"\n\n  Stopped early.")

    print(f"\n✅  Recorded {recorded} samples → {out_dir}")
    _print_next_steps(out_dir, phrase)


def _print_next_steps(out_dir: Path, phrase: str):
    sample_count = len(list(out_dir.glob("mic_*.wav")))
    synth_count  = len(list(out_dir.glob("pos_*.wav")))
    total        = sample_count + synth_count

    print(f"""
────────────────────────────────────────────────────────
  NEXT STEPS — choose one training path
────────────────────────────────────────────────────────

  You have {total} positive samples ({sample_count} mic + {synth_count} synthetic).
  Target: 100+ samples for a robust model.

  If you need more synthetic samples, run:
    python generate_hey_ziggy_dataset.py --lang he --n-pos 60

  ─────────────────────────────────────────────────
  PATH A  OpenWakeWord  (free, needs GPU/Colab)
  ─────────────────────────────────────────────────
  1. Run:  python train_hey_ziggy.py
     (checks if local training is possible)

  OR use Google Colab:
  • Open: https://colab.research.google.com/
  • Use OWW training notebook from:
    https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb
  • Upload your oww_data/ folder
  • Train and download hey_ziggy.onnx

  Then configure Ziggy:
    voice.wakeword_engine: oww
    voice.wakeword_model: ./models/wake/hey_ziggy.onnx
    voice.wakeword_threshold: 0.65

  ─────────────────────────────────────────────────
  PATH B  Porcupine  (easiest, free tier available)
  ─────────────────────────────────────────────────
  1. Sign up at https://console.picovoice.ai/
  2. Go to Wake Word → Create Wake Word
  3. Type your wake word phrase: {phrase}
  4. Upload the WAV files from:
       {out_dir}
  5. Download the .ppn model file
  6. Configure Ziggy:
       voice.wakeword_engine: porcupine
       voice.porcupine_access_key: YOUR_KEY_HERE
       voice.porcupine_keyword: ./models/wake/hey_ziggy.ppn
  ─────────────────────────────────────────────────
""")


if __name__ == "__main__":
    main()
