#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate a synthetic "Hey Ziggy" dataset with Piper TTS (no PyTorch needed).

Outputs 16 kHz mono WAVs under:
  ./oww_data/hey_ziggy/positives/*.wav
  ./oww_data/hey_ziggy/near_negatives/*.wav  (optional near-miss phrases)

Usage (basic):
  python generate_hey_ziggy_dataset.py

Usage (custom):
  python generate_hey_ziggy_dataset.py --n-pos 200 --n-near 80 --out oww_data

If you don't have Piper installed:
  pip install piper-tts soundfile scipy requests
"""

import argparse
import io
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List

import requests
import soundfile as sf
import numpy as np
from scipy.signal import resample_poly

# ---------------------------
# Config: voice to download
# ---------------------------
# English voice (LibriTTS-R medium — clean and robust)
VOICE_URL_ONNX = ("https://huggingface.co/rhasspy/piper-voices/resolve/main/"
                  "en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx")
VOICE_URL_JSON = ("https://huggingface.co/rhasspy/piper-voices/resolve/main/"
                  "en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json")

# Hebrew voice (sivri medium — used for 'היי זיגי' synthetic samples)
VOICE_URL_ONNX_HE = ("https://huggingface.co/rhasspy/piper-voices/resolve/main/"
                     "he/he_IL/sivri/medium/he_IL-sivri-medium.onnx")
VOICE_URL_JSON_HE = ("https://huggingface.co/rhasspy/piper-voices/resolve/main/"
                     "he/he_IL/sivri/medium/he_IL-sivri-medium.onnx.json")

VOICE_DIR    = Path("./piper_voices")
VOICE_ONNX   = VOICE_DIR / "en_US-libritts_r-medium.onnx"
VOICE_JSON   = VOICE_DIR / "en_US-libritts_r-medium.onnx.json"
VOICE_ONNX_HE = VOICE_DIR / "he_IL-sivri-medium.onnx"
VOICE_JSON_HE = VOICE_DIR / "he_IL-sivri-medium.onnx.json"

# Piper executable name (created by the piper-tts package)
PIPER_EXE = shutil.which("piper") or shutil.which("piper.exe")


def ensure_deps_or_die():
    if PIPER_EXE is None:
        print(
            "\n[!] Piper CLI not found. Install it first:\n"
            "    pip install piper-tts\n\n"
            "Then re-run this script.\n",
            file=sys.stderr,
        )
        sys.exit(1)


def download_file(url: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    print(f"[download] {url} -> {dest}")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    with open(dest, "wb") as f:
        f.write(r.content)


def ensure_voice_files(lang: str = "en"):
    if lang == "he":
        download_file(VOICE_URL_ONNX_HE, VOICE_ONNX_HE)
        download_file(VOICE_URL_JSON_HE, VOICE_JSON_HE)
    else:
        download_file(VOICE_URL_ONNX, VOICE_ONNX)
        download_file(VOICE_URL_JSON, VOICE_JSON)


def run_piper_to_wav(text: str, out_wav: Path, sample_rate: int = None, lang: str = "en"):
    """
    Run Piper CLI and synthesize `text` into `out_wav`.
    If sample_rate is provided, Piper will still use model's native rate;
    we resample afterward to target (e.g., 16000) for OpenWakeWord.
    """
    out_wav = Path(out_wav)
    out_wav.parent.mkdir(parents=True, exist_ok=True)

    voice_model = VOICE_ONNX_HE if lang == "he" else VOICE_ONNX
    cmd = [PIPER_EXE, "-m", str(voice_model), "-f", str(out_wav)]
    print(f"[piper] \"{text}\" -> {out_wav.name}")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = proc.communicate(input=text.encode("utf-8"), timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"Piper failed (code {proc.returncode}). STDERR:\n{stderr.decode('utf-8', 'ignore')}")

    if sample_rate is not None:
        _resample_wav_inplace(out_wav, sample_rate)


def _resample_wav_inplace(wav_path: Path, target_sr: int = 16000):
    data, sr = sf.read(str(wav_path), dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)  # mono
    if sr != target_sr:
        # high-quality polyphase resampling
        # resample_poly ups then downs: target_sr/sr
        g = np.gcd(sr, target_sr)
        up = target_sr // g
        down = sr // g
        data = resample_poly(data, up, down)
        sr = target_sr
    # normalize lightly to prevent clipping differences
    peak = np.max(np.abs(data)) + 1e-9
    data = (data / peak) * 0.95
    sf.write(str(wav_path), data, sr)


# --- phrase variant helpers ---------------------------------------------------

BASE_VARIANTS = [
    "Hey Ziggy",
    "hey Ziggy",
    "hey, Ziggy",
    "hey ziggy",
    "Hey, Ziggy!",
    "Hey Ziggy!",
    "Hey, Ziggy",
]

BASE_VARIANTS_HE = [
    "היי זיגי",
    "הי זיגי",
    "היי זיגי!",
    "היי, זיגי",
    "הי, זיגי",
    "היי זיגי?",
    "זיגי, שמע",
]

NEAR_MISS_VARIANTS = [
    "Hey Zig",
    "Hey Ziggie",
    "Hey Siggy",
    "Hey Piggy",
    "Hey Zig me",
    "Ziggy",
    "Hey Ziggyy",
    "Hey Zigbee",
    "Hey piggie",
]

NEAR_MISS_VARIANTS_HE = [
    "זיגי",
    "היי",
    "הי זיג",
    "שלום זיגי",
    "תגיד זיגי",
    "איפה זיגי",
]


def jitter_text(t: str) -> str:
    """Add tiny random punctuation/spacing jitter to create more variety."""
    # Randomly add mild exclamation or period
    if random.random() < 0.25:
        t = t + random.choice([".", "!", "…"])
    # Sometimes add a short pause comma
    if random.random() < 0.25 and "Ziggy" in t:
        t = t.replace("Ziggy", ", Ziggy")
    return t


def make_texts(n: int, pool: List[str]) -> List[str]:
    items = []
    for _ in range(n):
        t = random.choice(pool)
        items.append(jitter_text(t))
    return items


# --- main --------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Generate 'Hey Ziggy' / 'היי זיגי' dataset with Piper TTS.")
    ap.add_argument("--out",       type=str,  default="oww_data", help="Output root directory (default: oww_data)")
    ap.add_argument("--n-pos",     type=int,  default=80,          help="Number of positive samples (default: 80)")
    ap.add_argument("--n-near",    type=int,  default=30,          help="Number of near-miss negatives (default: 30)")
    ap.add_argument("--seed",      type=int,  default=42,          help="Random seed")
    ap.add_argument("--target-sr", type=int,  default=16000,       help="Target sample rate (default: 16000)")
    ap.add_argument("--lang",      type=str,  default="en",        choices=["en", "he"],
                    help="Language: 'en' = English 'Hey Ziggy', 'he' = Hebrew 'היי זיגי' (default: en)")
    args = ap.parse_args()

    random.seed(args.seed)
    lang = args.lang

    ensure_deps_or_die()
    ensure_voice_files(lang=lang)

    out_root = Path(args.out)
    pos_dir  = out_root / "hey_ziggy" / "positives"
    near_dir = out_root / "hey_ziggy" / "near_negatives"
    pos_dir.mkdir(parents=True, exist_ok=True)
    near_dir.mkdir(parents=True, exist_ok=True)

    pos_pool  = BASE_VARIANTS_HE  if lang == "he" else BASE_VARIANTS
    near_pool = NEAR_MISS_VARIANTS_HE if lang == "he" else NEAR_MISS_VARIANTS
    prefix    = "he_pos" if lang == "he" else "pos"
    near_pfx  = "he_near" if lang == "he" else "near"

    phrase_label = "'היי זיגי'" if lang == "he" else "'Hey Ziggy'"
    print(f"\nGenerating {args.n_pos} synthetic {phrase_label} samples using Piper ({lang})...\n")

    # Generate positives
    pos_texts = make_texts(args.n_pos, pos_pool)
    for i, t in enumerate(pos_texts, 1):
        out_wav = pos_dir / f"{prefix}_{i:04d}.wav"
        run_piper_to_wav(t, out_wav, sample_rate=args.target_sr, lang=lang)

    # Generate near-miss negatives
    near_texts = []
    if args.n_near > 0:
        near_texts = make_texts(args.n_near, near_pool)
        for i, t in enumerate(near_texts, 1):
            out_wav = near_dir / f"{near_pfx}_{i:04d}.wav"
            run_piper_to_wav(t, out_wav, sample_rate=args.target_sr, lang=lang)

    print("\n✅ Done.")
    print(f"Positives:      {len(pos_texts)} → {pos_dir}")
    print(f"Near negatives: {len(near_texts)} → {near_dir}")
    print("\nNext:")
    print("  Run python train_hey_ziggy.py  (or open the OWW Colab notebook)")
    print("  Or upload WAVs to https://console.picovoice.ai/ for a Porcupine .ppn model")


if __name__ == "__main__":
    main()
