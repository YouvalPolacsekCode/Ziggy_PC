#!/usr/bin/env python3
"""Vendor services/speech_text.py into the sibling repos that also speak Hebrew.

The spoken-text stage (pauses, spoken clock, number gender, the verified
pronunciation dictionary) is owned HERE, in ziggy_pc, where the Voice Lab
proves every entry by ear. Kinetic (the surfaces) and Jeff (the relay that
voices the Ziggy-expert and Jeff surfaces) get a byte-identical copy named
`hebrew_speech.py`, with a header naming the source commit. Their voice
modules call `hebrew_speech.speak_he(text)`.

  python scripts/voice_lab/sync_speech_text.py           # copy + report
  python scripts/voice_lab/sync_speech_text.py --check   # exit 1 if a copy drifted

The module has no ziggy_pc imports (settings are read inside try/except), so
it runs unchanged on Jeff's Python 3.9 and kinetic's 3.12.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "services" / "speech_text.py"
TARGETS = [
    Path.home() / "Code" / "kinetic" / "api" / "kinetic" / "hebrew_speech.py",
    Path.home() / "Code" / "jeff" / "jeff" / "hebrew_speech.py",
]


def _sha() -> str:
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def render(src_text: str) -> str:
    header = (
        "# VENDORED — do not edit here. Source of truth: ziggy_pc/services/speech_text.py\n"
        f"# (commit {_sha()}). Re-sync: python scripts/voice_lab/sync_speech_text.py\n"
        "# Every dictionary entry below was heard and approved in the Voice Lab.\n"
    )
    return header + src_text


def body_hash(text: str) -> str:
    """Hash without the vendoring header so --check ignores the commit line."""
    lines = [l for l in text.splitlines() if not l.startswith("# VENDORED") and not l.startswith("# (commit")
             and not l.startswith("# Every dictionary entry")]
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    src = SRC.read_text()
    want = body_hash(src)
    drift = 0
    for t in TARGETS:
        if not t.parent.exists():
            print(f"skip (repo not here): {t}")
            continue
        have = body_hash(t.read_text()) if t.exists() else None
        if a.check:
            ok = have == want
            drift += 0 if ok else 1
            print(f"{'ok     ' if ok else 'DRIFTED'} {t}")
            continue
        t.write_text(render(src))
        print(f"wrote {t}")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
