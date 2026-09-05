#!/usr/bin/env python3
"""Render the Voice Lab corpus through a named variant.

A variant = model + voice + speed + text pre-processing chain (+ dict id).
Output: voice_lab_out/<variant>/<line_id>.mp3 + manifest.json with the text
exactly as sent, timing and hashes. Idempotent: a line whose (variant, text)
hash already exists on disk is skipped.

Usage:
  python scripts/voice_lab/render.py baseline
  python scripts/voice_lab/render.py nikud --only c11,c12
  python scripts/voice_lab/render.py --list

Variants are defined in VARIANTS below. The `prep` field names a chain of
steps from scripts/voice_lab/prep.py (sanitize, normalize, lexicon, nikud).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lab_common import VOICES, api_key, render_bytes  # noqa: E402
import prep  # noqa: E402

ROOT = HERE.parents[1]
OUT_ROOT = ROOT / "voice_lab_out"

VARIANTS: dict[str, dict] = {
    # What Canary ships today (sanitize regex only).
    "baseline":      {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize"]},
    "s36":           {"model": "sonic-3.6", "voice": "yardena", "prep": ["sanitize"]},
    "nikud":         {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize", "nikud"]},
    "nikud36":       {"model": "sonic-3.6", "voice": "yardena", "prep": ["sanitize", "nikud"]},
    "norm":          {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize", "normalize", "lexicon"]},
    "norm36":        {"model": "sonic-3.6", "voice": "yardena", "prep": ["sanitize", "normalize", "lexicon"]},
    "full":          {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize", "normalize", "lexicon", "nikud"]},
    "full36":        {"model": "sonic-3.6", "voice": "yardena", "prep": ["sanitize", "normalize", "lexicon", "nikud"]},
    "slow":          {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize"], "speed": "slow"},
    # Sitting B candidates, built from sitting A's error map: pauses at ':'
    # and '(…)', 12-hour clock, construct numbers, nikud + domain fixups.
    # Latin brand names stayed correct in sitting A, so no lexicon step.
    "fix1":          {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize", "pauses", "normalize", "nikud"]},
    "fix2":          {"model": "sonic-3.6", "voice": "yardena", "prep": ["sanitize", "pauses", "normalize", "nikud"]},
    # Control: same text fixes WITHOUT nikud — isolates what nikud adds.
    "fix0":          {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize", "pauses", "normalize"]},
    # Insurance: phonemes instead of nikud, in case the engine ignores nikud.
    "fix3":          {"model": "sonic-3.5", "voice": "yardena", "prep": ["sanitize", "pauses", "normalize", "ipa"]},
    # Voice candidates for sitting B (baseline prep so only the voice differs).
    "voice_adi":     {"model": "sonic-3.5", "voice": "adi",     "prep": ["sanitize"]},
    "voice_gil":     {"model": "sonic-3.5", "voice": "gil",     "prep": ["sanitize"]},
    "voice_eitan":   {"model": "sonic-3.5", "voice": "eitan",   "prep": ["sanitize"]},
}


def load_corpus(path: Path | None = None) -> list[dict]:
    data = yaml.safe_load((path or HERE / "corpus.yaml").read_text())
    return list(data["lines"])


def render_variant(name: str, only: set[str] | None = None, corpus_path: Path | None = None,
                   dict_id: str | None = None) -> Path:
    spec = VARIANTS[name]
    out = OUT_ROOT / name
    out.mkdir(parents=True, exist_ok=True)
    man_path = out / "manifest.json"
    manifest = json.loads(man_path.read_text()) if man_path.exists() else {}

    from cartesia import Cartesia
    client = Cartesia(api_key=api_key())
    voice_id = VOICES[spec["voice"]]
    kw = {}
    if spec.get("speed") is not None:
        kw["speed"] = spec["speed"]
    if dict_id or spec.get("dict_id"):
        kw["pronunciation_dict_id"] = dict_id or spec["dict_id"]

    lines = load_corpus(corpus_path)
    n_ok = n_skip = n_err = 0
    for line in lines:
        lid = line["id"]
        if only and lid not in only:
            continue
        sent = prep.run(line["text"], spec["prep"])
        key = hashlib.sha256(json.dumps([spec, sent, kw], sort_keys=True, ensure_ascii=False)
                             .encode()).hexdigest()[:16]
        prev = manifest.get(lid)
        if prev and prev.get("key") == key and prev.get("ok") and (out / f"{lid}.mp3").exists():
            n_skip += 1
            continue
        rec = render_bytes(client, out, lid, spec["model"], sent, voice_id, **kw)
        rec.update(key=key, original=line["text"], bucket=line["bucket"], prep=spec["prep"])
        manifest[lid] = rec
        if rec["ok"]:
            n_ok += 1
            print(f"  {lid} ok {rec['duration_s']:.2f}s  {sent[:60]}")
        else:
            n_err += 1
            print(f"  {lid} ERR {rec.get('error', '')[:100]}")
        man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f"[{name}] rendered={n_ok} skipped={n_skip} errors={n_err} -> {out}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("variant", nargs="?")
    ap.add_argument("--only", default="")
    ap.add_argument("--corpus", default="")
    ap.add_argument("--dict-id", default="")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list or not a.variant:
        for k, v in VARIANTS.items():
            print(f"{k:14} {v}")
        return 0
    only = {s for s in a.only.split(",") if s} or None
    t0 = time.time()
    render_variant(a.variant, only, Path(a.corpus) if a.corpus else None, a.dict_id or None)
    print(f"took {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
