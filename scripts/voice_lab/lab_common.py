"""Shared helpers for the Voice Lab scripts (dev-only, never on hubs)."""
from __future__ import annotations

import hashlib
import json
import os
import struct
import time
from pathlib import Path

YARDENA = "c5bc902c-bc31-40a8-b81f-7d3a1e1920bd"
ADI     = "2821fd0c-35c7-4adf-9c42-32e394bf85cb"
GIL     = "84b969ad-19c7-428d-b742-48d387f7f138"
EITAN   = "daa4d6bb-da62-4e16-8065-76cd87942475"
VOICES = {"yardena": YARDENA, "adi": ADI, "gil": GIL, "eitan": EITAN}

OUTPUT_FORMAT = {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000}


def _main_checkout() -> Path:
    """The primary checkout (the worktree shares .git but not secrets)."""
    p = Path(__file__).resolve()
    for anc in p.parents:
        if (anc / "config" / "secrets.yaml").exists():
            return anc
    # worktree: .claude/worktrees/<name>/scripts/voice_lab/lab_common.py
    for anc in p.parents:
        if anc.name == ".claude":
            return anc.parent
    return p.parents[2]


def api_key() -> str:
    k = os.environ.get("CARTESIA_API_KEY", "").strip()
    if k:
        return k
    import yaml
    sec = _main_checkout() / "config" / "secrets.yaml"
    data = yaml.safe_load(sec.read_text()) or {}
    k = ((data.get("voice") or {}).get("cartesia") or {}).get("api_key", "")
    if not k:
        raise SystemExit(f"No Cartesia key: set CARTESIA_API_KEY or voice.cartesia.api_key in {sec}")
    return k.strip()


def mp3_duration_s(data: bytes) -> float:
    """Approximate MP3 duration by walking frame headers (MPEG-1 Layer III)."""
    bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
    rates = [44100, 48000, 32000, 0]
    i, frames, secs = 0, 0, 0.0
    n = len(data)
    if data[:3] == b"ID3" and n > 10:
        size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f)
        i = 10 + size
    while i + 4 <= n:
        if data[i] == 0xFF and (data[i + 1] & 0xE0) == 0xE0:
            ver = (data[i + 1] >> 3) & 3
            layer = (data[i + 1] >> 1) & 3
            br = bitrates[(data[i + 2] >> 4) & 0xF]
            sr = rates[(data[i + 2] >> 2) & 3]
            pad = (data[i + 2] >> 1) & 1
            if ver == 3 and layer == 1 and br and sr:
                flen = int(144000 * br / sr) + pad
                secs += 1152 / sr
                frames += 1
                i += flen
                continue
        i += 1
    return round(secs, 2)


def render_bytes(client, out: Path, pid: str, model: str, text: str, voice_id: str,
                 lang: str = "he", **kw) -> dict:
    """Render one line to out/<pid>.mp3; return a result record (never raises)."""
    rec = {"id": pid, "model": model, "voice": voice_id, "text": text, "kw": kw, "ok": False}
    t0 = time.time()
    try:
        it = client.tts.bytes(model_id=model, transcript=text,
                              voice={"mode": "id", "id": voice_id},
                              language=lang, output_format=OUTPUT_FORMAT, **kw)
        audio = bytes(it) if isinstance(it, (bytes, bytearray)) else b"".join(
            bytes(c) for c in it if isinstance(c, (bytes, bytearray)))
        rec["elapsed_s"] = round(time.time() - t0, 2)
        if not audio:
            rec["error"] = "empty audio"
            return rec
        path = out / f"{pid}.mp3"
        path.write_bytes(audio)
        rec.update(ok=True, bytes=len(audio), duration_s=mp3_duration_s(audio),
                   file=str(path), sha=hashlib.sha256(audio).hexdigest()[:12])
    except Exception as e:
        rec["elapsed_s"] = round(time.time() - t0, 2)
        rec["error"] = f"{type(e).__name__}: {e}"
    return rec
