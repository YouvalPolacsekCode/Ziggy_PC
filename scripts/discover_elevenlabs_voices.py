#!/usr/bin/env python3
"""Discover ElevenLabs voices verified for Hebrew (and English).

Usage:
    python scripts/discover_elevenlabs_voices.py [--lang he|en] [--query <text>]
                                                 [--category premade|professional|community]
                                                 [--preview-only] [--audition <voice_id>]

Examples:
    # List every premade voice ElevenLabs has verified for Hebrew, with audition URLs.
    python scripts/discover_elevenlabs_voices.py

    # Wider net — community + professional voices too.
    python scripts/discover_elevenlabs_voices.py --category community
    python scripts/discover_elevenlabs_voices.py --category professional

    # Render a sample Hebrew line through a candidate voice (saves WAV/MP3 to /tmp).
    python scripts/discover_elevenlabs_voices.py --audition <voice_id>

Requires ELEVENLABS_API_KEY in env, or `voice.elevenlabs.api_key` in
config/secrets.yaml. No live ElevenLabs traffic without the key — script
exits with a clear message.

Once you've picked voices, copy the voice_ids into config/settings.yaml under
voice.elevenlabs.{selected_voice_he, selected_voice_en, available_voices}.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

# Make `interfaces.tts.elevenlabs_tts` importable from the repo root.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from interfaces.tts import elevenlabs_tts as el  # noqa: E402


SAMPLE_HE = "שלום, אני זיגי. הדלקתי את האור בסלון."
SAMPLE_EN = "Hi, I'm Ziggy. I've turned on the living room light."


def list_voices(lang: str, query: str, category: str | None) -> None:
    voices = el.search_library(query=query, category=category, page_size=100)
    if not voices:
        if not el.is_available():
            print("[discover] ElevenLabs not configured. Set ELEVENLABS_API_KEY "
                  "or add voice.elevenlabs.api_key to config/secrets.yaml.")
        else:
            print("[discover] No voices returned. Try a different --query or --category.")
        return

    # Filter to voices ElevenLabs has explicitly verified for the target language.
    filtered = [v for v in voices if lang in (v.get("languages") or [])]
    if not filtered:
        print(f"[discover] {len(voices)} voices returned, but none are verified for "
              f"language={lang!r}. Try --category community for a wider pool.")
        return

    print(f"\n=== Voices verified for '{lang}' ({len(filtered)} found) ===\n")
    for v in filtered:
        preview = (v.get("preview_urls") or {}).get(lang) or v.get("preview_url") or "—"
        print(f"  • {v.get('name', '?'):<24}  id={v.get('id')}")
        print(f"    category: {v.get('category', '?'):<18}  langs: {','.join(v.get('languages') or [])}")
        print(f"    preview:  {preview}")
        print()

    print("Audition any of these in two ways:")
    print(f"  1. Open the preview URL in a browser (fastest).")
    print(f"  2. Render a Ziggy-flavored sample line:")
    print(f"       python {sys.argv[0]} --audition <voice_id> --lang {lang}")
    print()
    print("When ready, paste the chosen voice_ids into config/settings.yaml under")
    print("voice.elevenlabs.{selected_voice_he, selected_voice_en, available_voices}.")


def audition(voice_id: str, lang: str) -> int:
    sample = SAMPLE_HE if lang == "he" else SAMPLE_EN
    print(f"[discover] Rendering sample in voice {voice_id!r} ({lang})…")
    t0 = time.time()
    audio = el.preview(sample, voice_id=voice_id, lang=lang)
    if audio is None:
        print("[discover] Render failed. Check API key, voice_id, and language support.")
        return 1
    out = f"/tmp/ziggy_audition_{voice_id[:8]}_{lang}.mp3"
    with open(out, "wb") as f:
        f.write(audio)
    print(f"[discover] Wrote {out} ({len(audio)} bytes, {time.time() - t0:.2f}s)")
    print(f"[discover] Play it with:  afplay {out}     (macOS)")
    print(f"[discover]                 start {out}     (Windows)")
    print(f"[discover]                 mpv {out}       (Linux)")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lang", choices=("he", "en"), default="he",
                   help="Language to filter voices by (verified_languages). Default: he.")
    p.add_argument("--query", default="",
                   help="Free-text search passed to /v2/voices. Leave empty for a "
                        "broad scan of premade voices.")
    p.add_argument("--category", choices=("premade", "professional", "community"),
                   default=None,
                   help="Restrict to a voice category. Default: any (premade dominates).")
    p.add_argument("--audition", metavar="VOICE_ID",
                   help="Render the Ziggy sample line in this voice and write to /tmp.")
    args = p.parse_args()

    if args.audition:
        return audition(args.audition, args.lang)

    list_voices(args.lang, args.query, args.category)
    return 0


if __name__ == "__main__":
    sys.exit(main())
