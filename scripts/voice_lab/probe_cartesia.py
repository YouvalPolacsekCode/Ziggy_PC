#!/usr/bin/env python3
"""Cartesia Hebrew capability probes for the Voice Lab.

Answers, by calling the API (docs are behind a login), four questions the
TTS fix depends on:

  1. Does Cartesia accept Hebrew text WITH nikud, and does it change the
     rendering?  (heteronym sentences with/without vowel points)
  2. Does sonic-3.6 accept language=he?
  3. Do pronunciation dictionaries accept Hebrew entries (IPA), and does
     the render succeed with pronunciation_dict_id?  Also inline <<IPA>>.
  4. Does `speed` work on Hebrew?

Writes MP3s + probes.json to voice_lab_out/probe/ so the operator hears
them in sitting A.  Claude only verifies acceptance, bytes and duration.

Usage:  python scripts/voice_lab/probe_cartesia.py [--out DIR]
Key:    CARTESIA_API_KEY env, else voice.cartesia.api_key from the main
        checkout's config/secrets.yaml.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lab_common import (  # noqa: E402
    YARDENA, api_key, mp3_duration_s, render_bytes,
)

# Heteronym: ספר (sefer=book / sapar=barber / safar=counted). Without nikud the
# engine must guess; with nikud it must not.
HET_PLAIN = "הספר של רוני נמצא על השולחן בסלון."
HET_NIKUD = "הַסֵּפֶר שֶׁל רוֹנִי נִמְצָא עַל הַשֻּׁלְחָן בַּסָּלוֹן."
HET2_PLAIN = "הספר ספר את הכסף וסיפר לי."
HET2_NIKUD = "הַסַּפָּר סָפַר אֶת הַכֶּסֶף וְסִפֵּר לִי."
NUM_LINE = "המזגן בחדר שינה על 24 מעלות, והתאורה בסלון על 45 אחוז."
TIME_LINE = "האורות בסלון יכבו ב-23:00, והמזגן יופעל ב-6:30 בבוקר."
NAME_LINE = "הדלקתי את המנורה של רוני והפעלתי את הטלוויזיה בסלון עם Netflix."
# IPA for "Netflix" as Israelis say it.
INLINE_IPA_LINE = "הפעלתי את <<n|e|t|f|l|i|k|s>> בסלון."

PROBES = [
    # id, model, text, extra kwargs
    ("het1_plain_35",  "sonic-3.5", HET_PLAIN,  {}),
    ("het1_nikud_35",  "sonic-3.5", HET_NIKUD,  {}),
    ("het2_plain_35",  "sonic-3.5", HET2_PLAIN, {}),
    ("het2_nikud_35",  "sonic-3.5", HET2_NIKUD, {}),
    ("het1_plain_36",  "sonic-3.6", HET_PLAIN,  {}),
    ("het2_nikud_36",  "sonic-3.6", HET2_NIKUD, {}),
    ("num_35",         "sonic-3.5", NUM_LINE,   {}),
    ("num_36",         "sonic-3.6", NUM_LINE,   {}),
    ("time_35",        "sonic-3.5", TIME_LINE,  {}),
    ("name_35",        "sonic-3.5", NAME_LINE,  {}),
    ("name_36",        "sonic-3.6", NAME_LINE,  {}),
    ("inline_ipa_35",  "sonic-3.5", INLINE_IPA_LINE, {}),
    ("speed_slow_35",  "sonic-3.5", HET_PLAIN,  {"speed": "slow"}),
    ("speed_fast_35",  "sonic-3.5", HET_PLAIN,  {"speed": "fast"}),
    ("speed_num_35",   "sonic-3.5", HET_PLAIN,  {"speed": 0.85}),
]


def probe_dictionary(client, out: Path, results: list[dict]) -> None:
    """Create a dict with Hebrew + Latin keys, render with it, then delete."""
    name = f"ziggy-voice-lab-probe-{int(time.time())}"
    items = [
        {"text": "Netflix", "pronunciation": "n|e|t|f|l|i|k|s"},
        {"text": "רוני",    "pronunciation": "r|ˈo|n|i"},
        {"text": "מזגן",    "pronunciation": "m|a|z|ˈg|a|n"},
    ]
    rec = {"id": "dict_create", "ok": False}
    dict_id = None
    try:
        d = client.pronunciation_dicts.create(name=name, items=items)
        dict_id = getattr(d, "id", None)
        rec.update(ok=bool(dict_id), dict_id=dict_id,
                   raw=json.loads(d.model_dump_json()) if hasattr(d, "model_dump_json") else str(d))
    except Exception as e:
        rec["error"] = f"{type(e).__name__}: {e}"
    results.append(rec)
    if not dict_id:
        return
    for pid, model in (("dict_name_35", "sonic-3.5"), ("dict_name_36", "sonic-3.6")):
        results.append(render_bytes(client, out, pid, model, NAME_LINE, YARDENA,
                                    pronunciation_dict_id=dict_id))
    try:
        client.pronunciation_dicts.delete(dict_id)
        results.append({"id": "dict_delete", "ok": True})
    except Exception as e:
        results.append({"id": "dict_delete", "ok": False, "error": str(e)})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE.parents[1] / "voice_lab_out" / "probe"))
    ap.add_argument("--only", default="", help="comma list of probe ids")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    from cartesia import Cartesia
    client = Cartesia(api_key=api_key())

    only = {s for s in args.only.split(",") if s}
    results: list[dict] = []
    for pid, model, text, kw in PROBES:
        if only and pid not in only:
            continue
        results.append(render_bytes(client, out, pid, model, text, YARDENA, **kw))
        r = results[-1]
        print(f"{pid:18} {'OK ' if r['ok'] else 'ERR'} {r.get('bytes', 0):>7}B "
              f"{r.get('duration_s', 0):5.2f}s {r.get('elapsed_s', 0):5.2f}s  {r.get('error', '')[:90]}")
    if not only or "dict" in only:
        probe_dictionary(client, out, results)
        for r in results[-4:]:
            print(f"{r['id']:18} {'OK ' if r['ok'] else 'ERR'} {r.get('error', '')[:120]}")

    (out / "probes.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\nwrote {out / 'probes.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
