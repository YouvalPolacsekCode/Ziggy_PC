"""The Wi-Fi brand catalogue: integrity, and the promises it makes the UI.

Context. Of Home Assistant's 852 config-flow integrations only 295 announce
themselves; 266 physical-device integrations can never appear in a discovery
list. The gap is worst for small local brands, which is to say for our whole
market — every Israeli-made device in HA (Risco, SwitchBee, CoolAutomation,
Tami4, Read Your Meter) is in the invisible set, along with Tadiran and
Electra. This catalogue is how a customer reaches them.

The failure mode these tests exist to prevent is a brand button that cannot
work: an entry whose integration isn't in HA core, or is HACS-only, ships a
promise the hub can't keep. Tornado was left out for exactly that reason.
"""
from __future__ import annotations

import services.wifi_brands as wb


def test_every_brand_resolves_to_a_handler():
    for b in wb.listed():
        assert wb.handler_for(b["brand"]), f"{b['brand']} has no handler"


def test_every_brand_belongs_to_a_declared_category():
    known = {c["id"] for c in wb.CATEGORIES}
    for b in wb.listed():
        assert b["category"] in known, f"{b['brand']} has unknown category {b['category']}"


def test_categories_only_lists_ones_that_have_brands():
    """An empty category is a dead end on screen."""
    for c in wb.categories():
        assert c["count"] > 0
        assert wb.listed(c["id"]), f"category {c['id']} advertises brands but has none"


def test_filtering_by_category_is_honoured():
    climate = wb.listed("climate")
    assert climate
    assert all(b["category"] == "climate" for b in climate)
    assert {"tadiran", "electra"} <= {b["brand"] for b in climate}


def test_the_israeli_brands_are_present():
    """The reason this catalogue is curated rather than generated. If these
    regress out, the feature has lost its point."""
    brands = {b["brand"] for b in wb.listed()}
    for required in ("tadiran", "electra", "coolmaster", "risco", "switchbee", "tami4"):
        assert required in brands, f"missing Israeli brand: {required}"


def test_tornado_is_not_offered():
    """Tornado is Midea, which is HACS-only and ships on no hub. A button
    that cannot work is worse than no button."""
    assert wb.handler_for("tornado") is None


def test_switcher_is_not_in_the_catalogue():
    """It keeps its own dedicated flow; two doors to one device would be a
    confusing regression."""
    handlers = {wb.handler_for(b["brand"]) for b in wb.listed()}
    assert "switcher_kis" not in handlers


def test_unknown_brand_is_refused():
    """The catalogue is a security boundary, not a hint — the start route
    must not be usable to launch an arbitrary HA flow."""
    for junk in ("", "   ", "../../etc/passwd", "gree", "nope"):
        # NB "gree" is the HA handler, not a brand key — it must NOT resolve.
        assert wb.handler_for(junk) is None


def test_brand_keys_are_case_and_space_insensitive():
    assert wb.handler_for("  TADIRAN ") == "gree"


def test_listed_never_leaks_ha_vocabulary():
    """The customer bought a Tadiran and has never heard of Gree."""
    blob = str(wb.listed()).lower()
    for leak in ("gree", "electrasmart", "handler", "melcloud", "econet",
                 "sharkiq", "hydrawise", "config_flow", "integration"):
        assert leak not in blob, f"leaked HA vocabulary: {leak}"


def test_categories_payload_is_clean_too():
    blob = str(wb.categories()).lower()
    for leak in ("handler", "gree", "integration"):
        assert leak not in blob


# ── Guidance ────────────────────────────────────────────────────────────────

def test_guidance_names_the_brand_the_user_picked():
    msg = wb.abort_guidance("no_devices_found", "risco")
    assert msg and "Risco" in msg


def test_unrecognised_reason_gets_no_invented_cause():
    assert wb.abort_guidance("some_new_ha_reason", "tadiran") is None
