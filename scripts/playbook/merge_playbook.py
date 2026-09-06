"""Merge the playbook fragments into one corpus, and enforce the truth gate.

The playbook is written in slices (one file per writer under `docs/playbook/`).
This merges them, validates the shape, and — the part that matters — refuses to
publish any entry whose backing capabilities are not `live-prod` in the
technical catalog.

That gate is the whole reason the playbook is derived rather than written
free-hand: the catalog knows which features are orphaned, abandoned, flagged or
canary-only, so a sales document built from it cannot claim something that does
not ship. When a capability graduates to live-prod, its entries unlock on the
next build; when one regresses, they disappear.

Usage:
    python3 scripts/playbook/merge_playbook.py            # report only
    python3 scripts/playbook/merge_playbook.py --write    # write docs/playbook.json
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAGMENTS = os.path.join(REPO, "docs", "playbook", "*.json")
CATALOG = os.path.join(REPO, "docs", "capability-catalog.json")
OUT = os.path.join(REPO, "docs", "playbook.json")

TYPES = ("moment", "concept", "objection", "comparison", "persona",
         "journey", "pitch", "israel", "install", "pricing")
FAMILIES = ("comfort", "safety", "effort", "control", "money", "trust")
MOMENTS = ("morning", "leaving", "away", "arriving", "evening", "night")
ROOMS = ("bedroom", "living", "kitchen", "entrance", "bathroom", "outside",
         "whole-home", "kids", "office")

# Types allowed to make no feature claim, and so to carry no capabilities.
NO_CLAIM_OK = ("concept", "pitch", "persona", "israel", "install", "pricing",
               "journey", "comparison", "objection")

ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
# Engine vocabulary that must never reach a customer.
#
# Two traps learned the hard way. (1) A `comparison` entry MUST be able to name
# the thing it compares against — banning "Home Assistant" from the Home
# Assistant comparison is nonsense. (2) Hebrew substring matching is unsafe:
# "רכז " matches inside "מרכז" (centre) and "גשר" is an ordinary word, so both
# rejected perfectly good copy. Only unambiguous hub-words are banned outright.
ENGINE_LEAKS = ("home assistant", "homeassistant", "zigbee2mqtt", "entity_id",
                "openwakeword", "apscheduler")
# Matched on word boundaries — "api" otherwise fires inside "rapid".
ENGINE_LEAKS_WORD = ("mqtt", "yaml", "api", "webhook", "zigbee")
# Never acceptable to a customer in any entry type: the style guide retires these.
HUB_LEAKS = ("מרכזייה", "קונטרולר", "מרכזת")


def _live_capability_ids() -> tuple[set, dict]:
    with open(CATALOG, "r", encoding="utf-8") as fh:
        cat = json.load(fh)
    live, status = set(), {}
    for c in cat.get("capabilities", []):
        status[c["id"]] = c["status"]
        if c["status"] == "live-prod":
            live.add(c["id"])
    return live, status


def _load_fragments() -> tuple[list, list]:
    entries, problems = [], []
    for path in sorted(glob.glob(FRAGMENTS)):
        name = os.path.basename(path)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{name}: unreadable — {exc}")
            continue
        got = data.get("entries")
        if not isinstance(got, list):
            problems.append(f"{name}: no 'entries' list")
            continue
        for e in got:
            e["_source"] = name
            entries.append(e)
    return entries, problems


def validate(entry: dict, live: set, status: dict) -> list:
    """Return a list of reasons this entry may not publish. Empty == publishable."""
    errs = []
    eid = entry.get("id", "")
    if not ID_RE.match(str(eid)):
        errs.append(f"bad id {eid!r}")
    if entry.get("type") not in TYPES:
        errs.append(f"bad type {entry.get('type')!r}")
    for field in ("title_he", "title_en", "body_he", "body_en"):
        if not str(entry.get(field, "")).strip():
            errs.append(f"missing {field}")
    fam = entry.get("family")
    if fam and fam not in FAMILIES:
        errs.append(f"bad family {fam!r}")
    for m in entry.get("moments") or []:
        if m not in MOMENTS:
            errs.append(f"bad moment {m!r}")
    for r in entry.get("rooms") or []:
        if r not in ROOMS:
            errs.append(f"bad room {r!r}")

    caps = entry.get("capabilities") or []
    if not caps and entry.get("type") not in NO_CLAIM_OK:
        errs.append("no capabilities on a feature-claiming entry")
    # THE TRUTH GATE.
    for cid in caps:
        if cid not in status:
            errs.append(f"unknown capability {cid!r}")
        elif cid not in live:
            errs.append(f"capability {cid!r} is {status[cid]}, not live-prod")

    if entry.get("type") == "pricing" and not entry.get("needs_input"):
        errs.append("pricing entry without needs_input")

    blob = " ".join(str(entry.get(f, "")) for f in
                    ("title_he", "title_en", "body_he", "body_en")).lower()
    for term in HUB_LEAKS:
        if term in blob:
            errs.append(f"hub term leaked: {term!r}")
    # A comparison names its competitor by necessity; everything else may not.
    if entry.get("type") != "comparison":
        for term in ENGINE_LEAKS:
            if term in blob:
                errs.append(f"engine term leaked: {term!r}")
        for term in ENGINE_LEAKS_WORD:
            if re.search(rf"\b{re.escape(term)}\b", blob):
                errs.append(f"engine term leaked: {term!r}")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    live, status = _live_capability_ids()
    entries, problems = _load_fragments()
    print(f"catalog: {len(live)} live-prod capabilities")
    print(f"fragments: {len(entries)} entries from "
          f"{len(set(e['_source'] for e in entries))} files")
    for p in problems:
        print("  !", p)

    seen, published, rejected = {}, [], []
    for e in entries:
        errs = validate(e, live, status)
        eid = e.get("id")
        if eid in seen:
            errs.append(f"duplicate id (also in {seen[eid]})")
        else:
            seen[eid] = e.get("_source")
        (rejected if errs else published).append(
            {**e, "_errors": errs} if errs else e)

    print(f"\npublishable: {len(published)}   rejected: {len(rejected)}")
    if rejected:
        print("\nREJECTED (not published):")
        for e in rejected:
            print(f"  {e.get('id','?'):38s} [{e.get('_source','?')}]")
            for err in e["_errors"][:3]:
                print(f"      - {err}")

    by_type = Counter(e["type"] for e in published)
    print("\nby type:")
    for t in TYPES:
        if by_type.get(t):
            print(f"  {by_type[t]:4d}  {t}")

    axes = {
        "family": Counter(e.get("family") for e in published if e.get("family")),
        "moments": Counter(m for e in published for m in (e.get("moments") or [])),
        "rooms": Counter(r for e in published for r in (e.get("rooms") or [])),
    }
    print("\naxes coverage:")
    for name, c in axes.items():
        print(f"  {name}: " + ", ".join(f"{k}={v}" for k, v in c.most_common()))

    needs_input = [e["id"] for e in published if e.get("needs_input")]
    if needs_input:
        print(f"\nawaiting your input ({len(needs_input)}): {', '.join(needs_input)}")

    if not args.write:
        print("\n(report only — pass --write to emit docs/playbook.json)")
        return 0

    for e in published:
        e.pop("_source", None)
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO,
                         capture_output=True, text=True).stdout.strip()
    out = {
        "entries": sorted(published, key=lambda e: (e["type"], e["id"])),
        "counts": {"entries": len(published), "by_type": dict(by_type)},
        "axes": {k: dict(v) for k, v in axes.items()},
        "rejected": [{"id": e.get("id"), "errors": e["_errors"]} for e in rejected],
        "needs_input": needs_input,
        "built_from_commit": sha,
        "catalog_built_from": json.load(open(CATALOG, encoding="utf-8")).get(
            "built_from_commit", ""),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
