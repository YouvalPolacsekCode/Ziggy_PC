from scripts.catalog import merge_catalog as mc
from scripts.catalog import render_markdown as rm


def build_catalog():
    caps = [
        {
            "id": "precool-on-arrival", "name": "Pre-cool on Arrival",
            "pitch": "Your home is already cool when you walk in.",
            "what_it_does": "Watches for you crossing a wide ring around home and starts the AC early.",
            "layer": "presence", "audience": "user-facing",
            "status": "live-prod",
            "status_evidence": "bundle recipe at frontend/.../precool.jsx, shipped 286341c",
            "uses": ["presence-zones"],
            "surfaces": ["frontend/src/components/automations/bundles/recipes/precool.jsx"],
        },
        {
            "id": "leave-home", "name": "Leave Home",
            "pitch": "Everything shuts down when the last person leaves.",
            "what_it_does": "Triggers on any-presence going away and runs a shutdown bundle.",
            "layer": "presence", "audience": "user-facing",
            "status": "live-prod",
            "status_evidence": "shipped 153cc56, wired via bundle engine",
            "uses": ["presence-zones"],
            "surfaces": ["services/presence_side_effects.py"],
        },
        {
            "id": "dead-thing", "name": "Dead Thing",
            "pitch": "Something that no longer runs.",
            "what_it_does": "Was started only in core/ziggy_main.py, which never runs under uvicorn.",
            "layer": "platform", "audience": "internal",
            "status": "orphaned",
            "status_evidence": "no caller from backend/server.py; only core/ziggy_main.py:88",
            "uses": [], "surfaces": ["services/dead_thing.py"],
        },
    ]
    mechs = [{
        "id": "presence-zones", "name": "Presence Zones",
        "kind": "store", "what_it_is": "Geofence rings with lat/lon/radius, created and resized by wizards.",
        "surfaces": ["services/presence_engine.py"], "domain_concept": True,
        "health": "lan_host is IP-pinned and drifts with DHCP",
    }]
    return mc.merge(caps, mechs)


def test_render_includes_every_capability_name():
    md = rm.render(build_catalog())
    assert "Pre-cool on Arrival" in md
    assert "Leave Home" in md
    assert "Dead Thing" in md


def test_render_shows_status_and_evidence():
    md = rm.render(build_catalog())
    assert "live-prod" in md
    assert "orphaned" in md
    assert "286341c" in md


def test_render_has_a_mechanism_section_with_used_by():
    md = rm.render(build_catalog())
    assert "## Mechanisms" in md
    assert "Presence Zones" in md
    assert "leave-home" in md and "precool-on-arrival" in md


def test_render_surfaces_composition():
    md = rm.render(build_catalog())
    assert "presence-zones" in md


def test_render_includes_health_note():
    md = rm.render(build_catalog())
    assert "IP-pinned" in md


def test_render_starts_with_a_summary_table():
    md = rm.render(build_catalog())
    head = md.split("## ")[0]
    assert "3" in head  # capability count


def test_render_includes_value_stories_when_present():
    catalog = build_catalog()
    catalog["stories"] = [
        {"title": "Comfort on arrival", "blurb": "Ziggy gets there first.",
         "capability_ids": ["precool-on-arrival", "leave-home"]}
    ]
    md = rm.render(catalog)
    assert "## Value Stories" in md
    assert "Comfort on arrival" in md
    assert "Ziggy gets there first." in md
    assert md.index("## Value Stories") < md.index("## Capabilities")


def test_render_omits_value_stories_when_absent():
    md = rm.render(build_catalog())
    assert "## Value Stories" not in md
