"""Give every catalog record a territory, so the weekly refresh can see it.

The refresh hands each drafting agent "the current entries for this territory",
selected with `record["territory"] == territory` (refresh.caps_for_territory).
On 2026-09-19 that selection was returning almost nothing: **57 of 79
capabilities and 43 of 58 mechanisms had `territory: null`**, left unset by the
original extraction. Two consequences, both bad and both silent:

  * an entry with no territory can never be UPDATED by the weekly refresh —
    it appears in no brief, so 57 of 79 entries were unmaintainable; and
  * a drafting agent is told its territory is empty, so the honest move looks
    like ADDING a capability that already exists under a null tag. Two agents
    caught this by content-searching instead of trusting the brief; a third
    would eventually not.

Assignment is by `layer`, not by surfaces. Surface-voting was tried and is
wrong: it disagreed with 10 of the 22 human-assigned tags, putting `smart-room`
in `presence` and `home-modes` in `rooms-and-dashboard`, because a real
capability's files span several territories and the majority is not the point.
A layer already IS the curated answer to "what is this about", and where ground
truth exists it agrees with the human tag every time.

Only NULLS are filled. An existing tag is never overwritten — it is somebody's
judgement and outranks this table.

    python3 scripts/catalog/backfill_territories.py          # report
    python3 scripts/catalog/backfill_territories.py --apply  # write both copies
"""
from __future__ import annotations

import collections
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CATALOG = os.path.join(REPO, "docs/capability-catalog.json")
SHIPPED = os.path.join(REPO, "services/data/capability-catalog.json")

#: layer → territory. Every layer present in the catalog is listed; the six
#: that have human-assigned members agree with those members exactly.
LAYER_TERRITORY = {
    "Automations":           "automations-and-bundles",
    "Chat & voice":          "chat-and-assistant",
    "Climate & light":       "climate-and-lighting",
    "Presence":              "presence",
    "Daily life":            "tasks-events-weather",
    "Platform":              "platform",
    "Accounts & onboarding": "auth-and-onboarding",
    "Alerts & safety":       "alerts-and-vision",
    "Backup":                "backup-and-dr",
    "Cloud & billing":       "cloud-and-billing",
    "Devices":               "devices-and-pairing",
    "Fleet & releases":      "fleet-and-release",
    "Release":               "fleet-and-release",
    "IR & AC":               "ir-and-ac",
    "Language":              "i18n-and-hebrew",
    "Media":                 "media-and-entertainment",
    "Mobile app":            "mobile-native",
    "Notifications":         "mobile-and-push",
    "Rooms & dashboard":     "rooms-and-dashboard",
}


def territory_for(rec: dict) -> str | None:
    """The territory a record belongs to, or None when we genuinely cannot say.
    An existing tag always wins."""
    if rec.get("territory"):
        return rec["territory"]
    return LAYER_TERRITORY.get(rec.get("layer") or "")


def _mech_territory(mech: dict, caps: list[dict]) -> str | None:
    """A mechanism has no layer of its own — it belongs where the capabilities
    that USE it live. Unanimous consumers decide; a split stays None rather
    than being forced, because a genuinely shared mechanism has no one home."""
    if mech.get("territory"):
        return mech["territory"]
    owners = {territory_for(c) for c in caps if mech["id"] in (c.get("uses") or [])}
    owners.discard(None)
    return owners.pop() if len(owners) == 1 else None


def backfill(catalog: dict) -> dict:
    caps, mechs = catalog["capabilities"], catalog["mechanisms"]
    report: dict = {"caps_filled": [], "caps_unresolved": [],
                    "mechs_filled": [], "mechs_unresolved": []}
    for c in caps:
        if c.get("territory"):
            continue
        t = territory_for(c)
        if t:
            c["territory"] = t
            report["caps_filled"].append((c["id"], c.get("layer"), t))
        else:
            report["caps_unresolved"].append((c["id"], c.get("layer")))
    for m in mechs:
        if m.get("territory"):
            continue
        t = _mech_territory(m, caps)
        if t:
            m["territory"] = t
            report["mechs_filled"].append((m["id"], t))
        else:
            report["mechs_unresolved"].append(m["id"])
    return report


def main() -> int:
    apply = "--apply" in sys.argv
    catalog = json.load(open(CATALOG, encoding="utf-8"))
    before = collections.Counter(bool(c.get("territory")) for c in catalog["capabilities"])
    report = backfill(catalog)
    after = collections.Counter(bool(c.get("territory")) for c in catalog["capabilities"])

    print(f"capabilities tagged: {before[True]} → {after[True]} of {len(catalog['capabilities'])}")
    print(f"mechanisms filled:   {len(report['mechs_filled'])}")
    if report["caps_unresolved"]:
        print("\nUNRESOLVED capabilities (no layer mapping — assign by hand):")
        for cid, layer in report["caps_unresolved"]:
            print(f"  {cid:34} layer={layer!r}")
    if report["mechs_unresolved"]:
        print(f"\n{len(report['mechs_unresolved'])} mechanism(s) left untagged "
              f"(used across territories, no single home) — this is allowed.")

    print("\nper-territory capability counts after backfill:")
    for t, n in collections.Counter(c.get("territory") for c in catalog["capabilities"]).most_common():
        print(f"  {str(t):28} {n}")

    if not apply:
        print("\nDRY RUN — pass --apply to write")
        return 0
    for path in (CATALOG, SHIPPED):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("wrote", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
