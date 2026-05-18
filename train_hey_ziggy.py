#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Train a custom 'Hey Ziggy' / 'היי זיגי' wake word model using OpenWakeWord.

Run this AFTER you have positive samples in oww_data/hey_ziggy/positives/
(from record_hey_ziggy.py and/or generate_hey_ziggy_dataset.py).

Usage:
  python train_hey_ziggy.py               # train if possible, else guide
  python train_hey_ziggy.py --check       # only check readiness, don't train
  python train_hey_ziggy.py --out-model models/wake/hey_ziggy.onnx

Requirements for local training:
  pip install openwakeword[training]
  (installs torch, torchaudio, tensorflow — heavy; ~3 GB)

Alternative (no GPU needed):
  Use the OWW Colab notebook — see guidance printed below.
"""
import argparse
import os
import sys
from pathlib import Path


POS_DIR   = Path("oww_data/hey_ziggy/positives")
NEAR_DIR  = Path("oww_data/hey_ziggy/near_negatives")
MODEL_OUT = Path("models/wake/hey_ziggy.onnx")


def _count(d: Path) -> int:
    if not d.exists():
        return 0
    return len(list(d.glob("*.wav")))


def check_readiness() -> dict:
    pos_count  = _count(POS_DIR)
    near_count = _count(NEAR_DIR)

    has_oww_training = False
    try:
        import openwakeword.train  # noqa: F401
        has_oww_training = True
    except ImportError:
        pass

    has_torch = False
    try:
        import torch  # noqa: F401
        has_torch = True
    except ImportError:
        pass

    return {
        "pos_count":         pos_count,
        "near_count":        near_count,
        "has_oww_training":  has_oww_training,
        "has_torch":         has_torch,
        "ready_to_train":    pos_count >= 30 and has_oww_training and has_torch,
    }


def print_status(r: dict):
    ok = "✅"
    no = "❌"

    print(f"""
────────────────────────────────────────────────────────
  Hey Ziggy / היי זיגי — Wake Word Training Status
────────────────────────────────────────────────────────

  Positive samples   {ok if r['pos_count'] >= 30 else no}  {r['pos_count']} found in {POS_DIR}
                         (need ≥ 30; 100+ recommended)

  Near-miss samples  {'ℹ️' if r['near_count'] == 0 else ok}  {r['near_count']} found in {NEAR_DIR}
                         (optional, improves robustness)

  openwakeword       {ok if r['has_oww_training'] else no}  {'installed with [training] extras' if r['has_oww_training'] else 'training extras not installed'}

  torch              {ok if r['has_torch'] else no}  {'available' if r['has_torch'] else 'not found'}
""")


def print_local_training_steps():
    print("""
  ─────────────────────────────────────────────────
  LOCAL TRAINING  (Windows, no GPU — CPU is slow but works)
  ─────────────────────────────────────────────────

  1. Install training dependencies:
       pip install openwakeword[training]
     (This installs torch, torchaudio, tensorflow. ~3 GB. Takes a while.)

  2. Re-run this script:
       python train_hey_ziggy.py

  3. Training will run for ~20-60 min on CPU.
     Output: models/wake/hey_ziggy.onnx

  4. Configure Ziggy (config/settings.yaml):
       voice:
         wakeword_engine: oww
         wakeword_model: ./models/wake/hey_ziggy.onnx
         wakeword_threshold: 0.65
         wakeword_hits: 3
""")


def print_colab_path():
    print("""
  ─────────────────────────────────────────────────
  COLAB TRAINING  (free GPU, no local install needed)
  ─────────────────────────────────────────────────

  1. Go to:
     https://colab.research.google.com/

  2. Open the OWW training notebook:
     https://github.com/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb

  3. Upload your sample folder:
       oww_data/hey_ziggy/
     (use Colab file panel or Google Drive)

  4. In the notebook, set:
       TARGET_PHRASE = "hey ziggy"
       POSITIVE_CLIPS_DIR = "/content/oww_data/hey_ziggy/positives"

  5. Run all cells. Training takes ~10-20 min on a free T4 GPU.

  6. Download the exported model: hey_ziggy.onnx

  7. Place it at:
       models/wake/hey_ziggy.onnx

  8. Configure Ziggy (config/settings.yaml):
       voice:
         wakeword_engine: oww
         wakeword_model: ./models/wake/hey_ziggy.onnx
         wakeword_threshold: 0.65
         wakeword_hits: 3
""")


def print_porcupine_path():
    print("""
  ─────────────────────────────────────────────────
  PORCUPINE  (easiest — no training required)
  ─────────────────────────────────────────────────

  1. Sign up (free) at https://console.picovoice.ai/

  2. Navigate to Wake Word → Create Wake Word

  3. Type the wake word phrase:  hey ziggy  (or  היי זיגי )

  4. Click "Add Recordings" and upload WAV files from:
       oww_data/hey_ziggy/positives/

  5. Train (takes ~1 min in the browser)

  6. Download the model:  hey_ziggy_en_windows_v3_0_0.ppn
     (or the appropriate platform variant)

  7. Place it at:
       models/wake/hey_ziggy.ppn

  8. Get your free access key from the Picovoice Console dashboard.

  9. Configure Ziggy (config/settings.yaml):
       voice:
         wakeword_engine: porcupine
         porcupine_access_key: YOUR_ACCESS_KEY_HERE
         porcupine_keyword: ./models/wake/hey_ziggy.ppn
         wakeword_threshold: 0.65
         wakeword_hits: 2
""")


def run_local_training(out_model: Path):
    """Attempt local OWW training. Requires openwakeword[training]."""
    try:
        from openwakeword.train import train_model  # type: ignore
    except ImportError:
        print("[!] openwakeword training module not found.")
        print("    Run:  pip install openwakeword[training]")
        return False

    out_model.parent.mkdir(parents=True, exist_ok=True)

    print(f"\n[Train] Starting OWW training...")
    print(f"  Positives : {POS_DIR}  ({_count(POS_DIR)} files)")
    print(f"  Output    : {out_model}\n")

    try:
        train_model(
            positive_clips     = str(POS_DIR),
            negative_clips     = str(NEAR_DIR) if NEAR_DIR.exists() else None,
            output_model_path  = str(out_model),
            target_phrase      = "hey ziggy",
        )
        print(f"\n✅ Model saved: {out_model}")
        print(f"\nSet in config/settings.yaml:")
        print(f"  voice.wakeword_engine: oww")
        print(f"  voice.wakeword_model: {out_model}")
        return True
    except Exception as e:
        print(f"\n[!] Training failed: {e}")
        print("    Try the Colab notebook instead (see guidance above).")
        return False


def main():
    ap = argparse.ArgumentParser(description="Train Hey Ziggy wake word model.")
    ap.add_argument("--check",     action="store_true", help="Check readiness only, don't train")
    ap.add_argument("--out-model", type=str, default=str(MODEL_OUT), help=f"Output model path (default: {MODEL_OUT})")
    args = ap.parse_args()

    r = check_readiness()
    print_status(r)

    if r["pos_count"] == 0:
        print("  ⚠️  No positive samples found.")
        print(f"     Run first:  python record_hey_ziggy.py")
        print(f"           and:  python generate_hey_ziggy_dataset.py --lang he")
        print()
        return

    if r["pos_count"] < 30:
        print(f"  ⚠️  Only {r['pos_count']} samples found. 30+ recommended for a usable model.")
        print(f"     Add more with:  python record_hey_ziggy.py --count {30 - r['pos_count']}")
        print()

    if args.check:
        print_local_training_steps()
        print_colab_path()
        print_porcupine_path()
        return

    if r["ready_to_train"]:
        print("  Local training is possible. Starting...\n")
        run_local_training(Path(args.out_model))
    else:
        print("  Local training dependencies not fully installed.")
        print("  Choose a path:\n")
        print_local_training_steps()
        print_colab_path()
        print_porcupine_path()


if __name__ == "__main__":
    main()
