#!/usr/bin/env python3
"""Run every Hebrew STT candidate on the operator's recordings; score WER.

  python scripts/voice_lab/stt_bakeoff.py                 # all candidates that can run
  python scripts/voice_lab/stt_bakeoff.py --only ivrit_turbo,cartesia_ink
  python scripts/voice_lab/stt_bakeoff.py --list

Candidates (each skips itself with a reason when it cannot run):
  whisper1        OpenAI whisper-1, the production path (needs OPENAI_API_KEY)
  gpt4o_transcribe OpenAI gpt-4o-transcribe (needs OPENAI_API_KEY)
  ivrit_turbo     ivrit-ai/whisper-large-v3-turbo-ct2 via faster-whisper (local)
  ivrit_large     ivrit-ai/whisper-large-v3-ct2 via faster-whisper (local, slower)
  whisper_large   openai large-v3 via faster-whisper (local, untuned control)
  cartesia_ink    Cartesia Ink (ink-whisper) batch STT (Cartesia key)

Recordings: voice_lab_out/stt_audio/<id>.<ext> from the review page's
record tab. Reference text: stt_script.yaml. Scoring normalises Hebrew:
strips nikud and punctuation, unifies final letters, lowercases Latin, and
tolerates the hyphenated number prefix ("ל-24" == "ל 24").
Results → voice_lab_out/stt_bakeoff.json + a table on stdout.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lab_common import api_key as cartesia_key  # noqa: E402

OUT = HERE.parents[1] / "voice_lab_out"
AUDIO = OUT / "stt_audio"

_NIKUD = re.compile(r"[֑-ׇ]")
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_FINALS = str.maketrans("ךםןףץ", "כמנפצ")
_HE_PROMPT = ("זיגי, הדלק, כבה, מזגן, תאורה, אור, סלון, משרד, מטבח, חדר שינה, "
              "תריסים, מאוורר, טמפרטורה, לחות, מצב הבית, לילה טוב, הגדר, כוון, הוסף משימה, תזכורת")


def norm(s: str) -> str:
    s = _NIKUD.sub("", s or "")
    s = s.replace("-", " ").replace("־", " ")
    s = _PUNCT.sub(" ", s).lower().translate(_FINALS)
    return re.sub(r"\s+", " ", s).strip()


def to_wav16k(src: Path) -> Path:
    """faster-whisper decodes most containers, but Ink wants a real WAV."""
    dst = Path(tempfile.gettempdir()) / f"vlab_{src.stem}.wav"
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "16000", str(dst)],
                       check=True)
    return dst


# ---- candidates -----------------------------------------------------------
def _openai(model: str):
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        return None, "OPENAI_API_KEY not set"
    from openai import OpenAI
    client = OpenAI(api_key=key)

    def run(path: Path) -> str:
        with open(to_wav16k(path), "rb") as f:
            r = client.audio.transcriptions.create(model=model, file=f, language="he", prompt=_HE_PROMPT)
        return r.text
    return run, None


def _faster_whisper(model_name: str):
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        return None, f"faster-whisper missing: {e}"
    t0 = time.time()
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
    except Exception as e:
        return None, f"model load failed: {e}"
    print(f"    [{model_name}] loaded in {time.time() - t0:.1f}s")

    def run(path: Path) -> str:
        segs, _ = model.transcribe(str(path), language="he", beam_size=5, vad_filter=True,
                                   condition_on_previous_text=False, initial_prompt=_HE_PROMPT)
        return " ".join(s.text for s in segs)
    return run, None


def _cartesia_ink():
    try:
        from cartesia import Cartesia
        client = Cartesia(api_key=cartesia_key())
    except Exception as e:
        return None, f"cartesia unavailable: {e}"

    def run(path: Path) -> str:
        with open(to_wav16k(path), "rb") as f:
            r = client.stt.transcribe(file=f, model="ink-whisper", language="he")
        return getattr(r, "text", "") or ""
    return run, None


CANDIDATES = {
    "whisper1":         lambda: _openai("whisper-1"),
    "gpt4o_transcribe": lambda: _openai("gpt-4o-transcribe"),
    "ivrit_turbo":      lambda: _faster_whisper("ivrit-ai/whisper-large-v3-turbo-ct2"),
    "ivrit_large":      lambda: _faster_whisper("ivrit-ai/whisper-large-v3-ct2"),
    "whisper_large":    lambda: _faster_whisper("large-v3"),
    "cartesia_ink":     _cartesia_ink,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        print("\n".join(CANDIDATES))
        return 0
    only = {s for s in a.only.split(",") if s}

    script = {l["id"]: l["text"] for l in yaml.safe_load((HERE / "stt_script.yaml").read_text())["lines"]}
    files = {p.stem: p for p in AUDIO.glob("*") if p.stem in script} if AUDIO.exists() else {}
    if not files:
        print(f"No recordings in {AUDIO}. Use the review page's record tab first.")
        return 1
    print(f"{len(files)} recordings, {len(script)} script lines")

    import jiwer
    results: dict[str, dict] = {}
    for name, factory in CANDIDATES.items():
        if only and name not in only:
            continue
        print(f"\n== {name}")
        run, why = factory()
        if run is None:
            print(f"    skipped: {why}")
            results[name] = {"skipped": why}
            continue
        hyps, refs, per_line, secs = [], [], {}, 0.0
        for lid, path in sorted(files.items()):
            t0 = time.time()
            try:
                hyp = run(path)
            except Exception as e:
                hyp = ""
                print(f"    {lid} ERROR {e}")
            dt = time.time() - t0
            secs += dt
            r, h = norm(script[lid]), norm(hyp)
            refs.append(r); hyps.append(h)
            w = jiwer.wer(r, h) if r else 0.0
            per_line[lid] = {"ref": script[lid], "hyp": hyp, "wer": round(w, 3), "s": round(dt, 2)}
            flag = "  " if w == 0 else "✗ "
            print(f"    {flag}{lid} {w:5.2f} {dt:4.1f}s  {hyp.strip()[:70]}")
        wer = jiwer.wer(refs, hyps)
        results[name] = {"wer": round(wer, 4), "lines": len(files), "avg_s": round(secs / len(files), 2),
                         "exact": sum(1 for l in per_line.values() if l["wer"] == 0), "per_line": per_line}
        print(f"    WER {wer:.3f}  exact {results[name]['exact']}/{len(files)}  avg {secs / len(files):.2f}s")

    (OUT / "stt_bakeoff.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"\n{'candidate':18} {'WER':>6} {'exact':>7} {'avg s':>6}")
    for n, r in results.items():
        if "wer" in r:
            print(f"{n:18} {r['wer']:6.3f} {r['exact']:>3}/{r['lines']:<3} {r['avg_s']:6.2f}")
        else:
            print(f"{n:18} skipped: {r['skipped']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
