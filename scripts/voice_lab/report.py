#!/usr/bin/env python3
"""Turn a sitting's verdicts into the error map for the next build.

  python scripts/voice_lab/report.py A            # rate + pairs summary
  python scripts/voice_lab/report.py B --json     # machine-readable

Rate mode → per-bucket good/bad counts, the bad lines with the words the
operator marked and their notes. Pairs/AB mode → wins per kind / per
variant.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "voice_lab_out"


def load(sitting: str) -> dict[str, dict]:
    p = OUT / "verdicts" / f"{sitting}.jsonl"
    latest: dict[str, dict] = {}
    if p.exists():
        for ln in p.read_text().splitlines():
            if ln.strip():
                r = json.loads(ln)
                latest[r["mode"] + ":" + r["key"]] = r   # last write wins
    return latest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sitting", nargs="?", default="A")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    verdicts = load(a.sitting)
    corpus = {l["id"]: l for l in yaml.safe_load((HERE / "corpus.yaml").read_text())["lines"]}

    rate = [v for v in verdicts.values() if v["mode"] == "rate"]
    by_bucket: dict[str, Counter] = defaultdict(Counter)
    bad_lines = []
    for v in rate:
        b = corpus.get(v["line_id"], {}).get("bucket", "?")
        by_bucket[b][v.get("verdict", "?")] += 1
        if v.get("verdict") == "bad":
            bad_lines.append({"id": v["line_id"], "bucket": b, "variant": v.get("variant"),
                              "text": v["text"], "bad_words": v.get("bad_text") or [], "note": v.get("note", "")})
    word_hits = Counter(w for l in bad_lines for w in l["bad_words"])

    pairs = [v for v in verdicts.values() if v["mode"] in ("pairs", "ab")]
    pair_wins: dict[str, Counter] = defaultdict(Counter)
    for v in pairs:
        kind = v.get("kind") or "ab"
        pick = v.get("verdict")
        if pick == "same":
            pair_wins[kind]["same"] += 1
        elif pick in ("a", "b"):
            side = v.get(pick) or {}
            pair_wins[kind][side.get("variant") or side.get("id") or pick] += 1

    out = {
        "sitting": a.sitting,
        "rated": len(rate),
        "buckets": {b: dict(c) for b, c in sorted(by_bucket.items())},
        "bad_lines": bad_lines,
        "worst_words": word_hits.most_common(20),
        "pairs": {k: dict(c) for k, c in pair_wins.items()},
    }
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return 0

    print(f"Sitting {a.sitting}: {len(rate)} rated, {len(bad_lines)} bad, {len(pairs)} pair verdicts\n")
    print(f"{'bucket':10} {'good':>5} {'bad':>5}")
    for b, c in sorted(by_bucket.items()):
        print(f"{b:10} {c.get('good', 0):>5} {c.get('bad', 0):>5}")
    if word_hits:
        print("\nMost-marked words:", ", ".join(f"{w} ×{n}" if n > 1 else w for w, n in word_hits.most_common(20)))
    if bad_lines:
        print("\nBad lines:")
        for l in bad_lines:
            print(f"  {l['id']} [{l['bucket']}] {l['text']}")
            if l["bad_words"]:
                print(f"       marked: {' · '.join(l['bad_words'])}")
            if l["note"]:
                print(f"       note:   {l['note']}")
    if pair_wins:
        print("\nPairs:")
        for k, c in pair_wins.items():
            print(f"  {k:8} " + ", ".join(f"{who}={n}" for who, n in c.most_common()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
