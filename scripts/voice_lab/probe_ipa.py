#!/usr/bin/env python3
"""Does Cartesia accept phonikud-style IPA (χ ʁ ʔ ʃ ts, ˈ stress) inline for
Hebrew? API-acceptance only; the operator hears the result in the lab."""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lab_common import YARDENA, api_key, render_bytes  # noqa: E402

TESTS = {
    "ipa_dud_35":     "<<h|a|d|ˈu|d>> <<d|o|l|ˈe|k>> כבר חצי שעה.",
    "ipa_chi_35":     "<<h|a|χ|a|l|ˈo|n>> <<b|a|m|i|t|b|ˈa|χ>> פתוח.",
    "ipa_resh_35":    "<<b|a|χ|a|d|ˈa|ʁ>> <<ʃ|e|n|ˈa>> יש אור.",
    "ipa_glottal_35": "<<ʔ|ˈe|t>> האור.",
    "ipa_dud_36":     "<<h|a|d|ˈu|d>> <<d|o|l|ˈe|k>> כבר חצי שעה.",
}


def main() -> int:
    from cartesia import Cartesia
    client = Cartesia(api_key=api_key())
    out = HERE.parents[1] / "voice_lab_out" / "probe"
    out.mkdir(parents=True, exist_ok=True)
    for pid, text in TESTS.items():
        model = "sonic-3.6" if pid.endswith("36") else "sonic-3.5"
        r = render_bytes(client, out, pid, model, text, YARDENA)
        print(f"{pid:16} {'OK ' if r['ok'] else 'ERR'} {r.get('duration_s', 0):5.2f}s {r.get('error', '')[:120]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
