"""The closed-loop capabilities are in the catalog Ziggy reads about himself."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEW_IDS = {"home-modes", "light-hold", "buttons-from-chat"}


def _caps(p):
    return {c["id"]: c for c in json.loads((ROOT / p).read_text(encoding="utf-8"))["capabilities"]}


def test_new_capabilities_present_in_both_copies():
    for p in ("docs/capability-catalog.json", "services/data/capability-catalog.json"):
        caps = _caps(p)
        assert NEW_IDS <= set(caps), p
        for cid in NEW_IDS:
            c = caps[cid]
            assert c["pitch"] and c["what_it_does"] and c["known_gaps"] and c["surfaces"], cid
            assert c["status"] == "canary-only"


def test_counts_match_entries():
    d = json.loads((ROOT / "docs/capability-catalog.json").read_text(encoding="utf-8"))
    assert d["counts"]["capabilities"] == len(d["capabilities"])
    assert d["counts"]["by_status"]["canary-only"] == sum(1 for c in d["capabilities"] if c["status"] == "canary-only")


def test_lookup_finds_modes_by_plain_words():
    from services import capability_lookup as CL
    hits = CL.search("guest mode vacation movie", limit=5)
    assert any(h["id"] == "home-modes" for h in hits)
