"""Every catalog record must carry a territory, or the weekly refresh is blind to it.

The refresh selects a brief's current entries with `record["territory"] ==
territory`. On 2026-09-19 that returned almost nothing — 57 of 79 capabilities
were untagged — so most drafting agents were told their territory was empty.
Three of sixteen caught it by content-searching anyway; the failure mode is an
agent trusting the brief and ADDING a capability that already exists.
"""
import json
from pathlib import Path

import pytest

from scripts.catalog import backfill_territories as BT

ROOT = Path(__file__).resolve().parent.parent
CATALOG = json.loads((ROOT / "docs/capability-catalog.json").read_text(encoding="utf-8"))
CONFIG = json.loads((ROOT / "catalog.config.json").read_text(encoding="utf-8"))


def test_every_layer_in_the_catalog_has_a_territory():
    """A layer with no mapping silently leaves its capabilities unreachable."""
    layers = {c.get("layer") for c in CATALOG["capabilities"] if c.get("layer")}
    missing = sorted(l for l in layers if l not in BT.LAYER_TERRITORY)
    assert not missing, f"layers with no territory mapping: {missing}"


def test_every_mapped_territory_actually_exists():
    known = set(CONFIG["territories"])
    bogus = {l: t for l, t in BT.LAYER_TERRITORY.items() if t not in known}
    assert not bogus, f"mapped to territories that do not exist: {bogus}"


# `territory` and `layer` answer different questions and are allowed to differ:
# a territory says WHICH FILES this entry is maintained from (it decides whose
# brief sees it next refresh), a layer says WHAT IT IS ABOUT to a person. The
# table below is only a backfill heuristic for records that have neither.
#
# Each divergence here is deliberate and load-bearing:
#   household-organizer / live-answers — reached THROUGH chat, filed with chat
#   cloud-brain-relay                  — a platform concern, maintained with chat
#   hebrew-voice-lab                   — a Hebrew tool living in scripts/**
#   app-motion-and-gestures            — the app's motion layer, maintained
#                                        with the screens it animates
# A NEW divergence that nobody wrote down still fails this test.
KNOWN_DIVERGENCES = {
    ("household-organizer", "Daily life"): "chat-and-assistant",
    ("cloud-brain-relay", "Platform"): "chat-and-assistant",
    ("live-answers", "Daily life"): "chat-and-assistant",
    ("hebrew-voice-lab", "Language"): "fleet-and-release",
    ("app-motion-and-gestures", "Mobile app"): "rooms-and-dashboard",
}


def test_every_capability_has_at_least_one_routed_surface():
    """A capability none of whose files map to a territory is invisible to the
    refresh: no brief ever covers it, so it can only be found by luck. That is
    how the motion layer and external assistants went uncatalogued until an
    agent reached outside its own partition."""
    from scripts.catalog import build_territories as bt
    cfg = bt.load_config(str(ROOT / "catalog.config.json"))
    orphans = []
    for c in CATALOG["capabilities"]:
        routed = False
        for s in c.get("surfaces") or []:
            rel = s[len("ziggy_pc/"):] if s.startswith("ziggy_pc/") else s
            root = "ziggy_mobile" if s.startswith("ziggy_mobile/") else "ziggy_pc"
            if root == "ziggy_mobile":
                rel = s[len("ziggy_mobile/"):]
            if bt.assign_territory(rel, cfg, root=root):
                routed = True
                break
        if not routed and (c.get("surfaces") or []):
            orphans.append(c["id"])
    assert not orphans, (
        f"{len(orphans)} capabilit(y/ies) whose every surface is unrouted — no "
        f"brief will ever see them: {orphans}")


def test_mapping_agrees_with_every_human_assignment():
    """Where a human already chose, the table must not contradict them —
    except for the divergences recorded above.

    This is the guard that made `layer` the signal instead of surface-voting,
    which disagreed with 10 of the 22 (it put smart-room in `presence`).
    """
    clashes = []
    for c in CATALOG["capabilities"]:
        have, layer = c.get("territory"), c.get("layer")
        if not have or layer not in BT.LAYER_TERRITORY:
            continue
        if BT.LAYER_TERRITORY[layer] == have:
            continue
        if KNOWN_DIVERGENCES.get((c["id"], layer)) == have:
            continue
        clashes.append((c["id"], layer, have, BT.LAYER_TERRITORY[layer]))
    assert not clashes, f"table contradicts a human assignment: {clashes}"


def test_an_existing_territory_is_never_overwritten():
    cat = {"capabilities": [{"id": "x", "layer": "Automations", "territory": "presence",
                             "uses": []}],
           "mechanisms": []}
    BT.backfill(cat)
    assert cat["capabilities"][0]["territory"] == "presence"


def test_nulls_are_filled_from_the_layer():
    cat = {"capabilities": [{"id": "x", "layer": "Climate & light", "uses": []}],
           "mechanisms": []}
    report = BT.backfill(cat)
    assert cat["capabilities"][0]["territory"] == "climate-and-lighting"
    assert report["caps_filled"] == [("x", "Climate & light", "climate-and-lighting")]


def test_an_unknown_layer_is_reported_not_guessed():
    cat = {"capabilities": [{"id": "x", "layer": "Something New", "uses": []}],
           "mechanisms": []}
    report = BT.backfill(cat)
    assert "territory" not in cat["capabilities"][0]
    assert report["caps_unresolved"] == [("x", "Something New")]


def test_a_mechanism_follows_its_only_consumer():
    cat = {"capabilities": [{"id": "c", "layer": "Presence", "uses": ["m"]}],
           "mechanisms": [{"id": "m"}]}
    BT.backfill(cat)
    assert cat["mechanisms"][0]["territory"] == "presence"


def test_a_shared_mechanism_stays_untagged():
    """A mechanism two territories use has no single home — forcing one would
    be a lie, and the brief can show it in both by other means."""
    cat = {"capabilities": [{"id": "a", "layer": "Presence", "uses": ["m"]},
                            {"id": "b", "layer": "Media", "uses": ["m"]}],
           "mechanisms": [{"id": "m"}]}
    report = BT.backfill(cat)
    assert "territory" not in cat["mechanisms"][0]
    assert report["mechs_unresolved"] == ["m"]


@pytest.mark.parametrize("path", ["docs/capability-catalog.json",
                                  "services/data/capability-catalog.json"])
def test_shipped_catalog_is_fully_tagged(path):
    """The regression guard: once backfilled, it must stay backfilled."""
    cat = json.loads((ROOT / path).read_text(encoding="utf-8"))
    untagged = [c["id"] for c in cat["capabilities"] if not c.get("territory")]
    assert not untagged, (
        f"{len(untagged)} capabilit(y/ies) with no territory — the weekly refresh "
        f"cannot see them: {untagged[:8]}")
