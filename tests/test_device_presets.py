"""Unit tests for services.device_presets — the named per-device saved-position store.

Pure logic (no HA): save/list/rename/delete + the per-entity cap and the
settings sanitiser. Mirrors the state_memory test style: monkeypatch the store
file to a tmp path so nothing touches user_files/.
"""
import importlib

import pytest


@pytest.fixture
def dp(tmp_path, monkeypatch):
    import services.device_presets as dp
    importlib.reload(dp)
    monkeypatch.setattr(dp, "STORE_FILE", str(tmp_path / "device_presets.json"))
    return dp


def test_add_and_list(dp):
    p = dp.add_preset("light.kitchen", "Cozy", {"brightness_pct": 40, "color_temp_kelvin": 2700})
    assert p["name"] == "Cozy"
    assert p["settings"] == {"brightness_pct": 40, "color_temp_kelvin": 2700}
    assert p["id"]
    listed = dp.list_presets("light.kitchen")
    assert len(listed) == 1
    assert listed[0]["id"] == p["id"]


def test_list_empty_for_unknown_entity(dp):
    assert dp.list_presets("light.nope") == []


def test_presets_are_per_entity(dp):
    dp.add_preset("light.a", "One", {"brightness_pct": 50})
    dp.add_preset("light.b", "Two", {"brightness_pct": 60})
    assert len(dp.list_presets("light.a")) == 1
    assert len(dp.list_presets("light.b")) == 1
    assert dp.list_presets("light.a")[0]["name"] == "One"


def test_rgb_preset_is_kept(dp):
    p = dp.add_preset("light.rgb", "Ocean", {"brightness_pct": 80, "rgb_color": [122, 174, 224]})
    assert p["settings"]["rgb_color"] == [122, 174, 224]


def test_sanitizer_strips_unknown_keys(dp):
    p = dp.add_preset("light.k", "X", {
        "brightness_pct": 30, "color_temp_kelvin": 3000,
        "entity_id": "light.k", "junk": 1, "effect": "blink",
    })
    assert set(p["settings"].keys()) == {"brightness_pct", "color_temp_kelvin"}


def test_brightness_is_required(dp):
    with pytest.raises(ValueError):
        dp.add_preset("light.k", "NoBright", {"color_temp_kelvin": 3000})


def test_brightness_bounds_enforced(dp):
    with pytest.raises(ValueError):
        dp.add_preset("light.k", "TooBig", {"brightness_pct": 250})
    with pytest.raises(ValueError):
        dp.add_preset("light.k", "TooSmall", {"brightness_pct": 0})


def test_rgb_must_be_three_bytes(dp):
    with pytest.raises(ValueError):
        dp.add_preset("light.k", "BadRgb", {"brightness_pct": 50, "rgb_color": [300, 0, 0]})
    with pytest.raises(ValueError):
        dp.add_preset("light.k", "ShortRgb", {"brightness_pct": 50, "rgb_color": [1, 2]})


def test_empty_name_rejected(dp):
    with pytest.raises(ValueError):
        dp.add_preset("light.k", "   ", {"brightness_pct": 50})


def test_name_is_trimmed(dp):
    p = dp.add_preset("light.k", "  Cozy  ", {"brightness_pct": 50})
    assert p["name"] == "Cozy"


def test_cap_enforced(dp):
    for i in range(dp.MAX_PRESETS_PER_ENTITY):
        dp.add_preset("light.k", f"P{i}", {"brightness_pct": 10 + i})
    with pytest.raises(dp.PresetLimitError):
        dp.add_preset("light.k", "OneTooMany", {"brightness_pct": 99})
    assert len(dp.list_presets("light.k")) == dp.MAX_PRESETS_PER_ENTITY


def test_delete(dp):
    p = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    assert dp.delete_preset("light.k", p["id"]) is True
    assert dp.list_presets("light.k") == []


def test_delete_unknown_returns_false(dp):
    assert dp.delete_preset("light.k", "nope") is False


def test_delete_frees_cap_slot(dp):
    ids = [dp.add_preset("light.k", f"P{i}", {"brightness_pct": 10 + i})["id"]
           for i in range(dp.MAX_PRESETS_PER_ENTITY)]
    dp.delete_preset("light.k", ids[0])
    # room again
    dp.add_preset("light.k", "New", {"brightness_pct": 77})
    assert len(dp.list_presets("light.k")) == dp.MAX_PRESETS_PER_ENTITY


def test_rename(dp):
    p = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    renamed = dp.rename_preset("light.k", p["id"], "Snug")
    assert renamed["name"] == "Snug"
    assert dp.list_presets("light.k")[0]["name"] == "Snug"


def test_rename_unknown_raises(dp):
    with pytest.raises(KeyError):
        dp.rename_preset("light.k", "nope", "X")


def test_rename_empty_rejected(dp):
    p = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    with pytest.raises(ValueError):
        dp.rename_preset("light.k", p["id"], "  ")


def test_new_preset_is_not_default(dp):
    p = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    assert p["is_default"] is False
    assert dp.get_default("light.k") is None


def test_set_and_get_default(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    dp.add_preset("light.k", "Bright", {"brightness_pct": 90})
    dp.set_default("light.k", a["id"])
    d = dp.get_default("light.k")
    assert d["id"] == a["id"]
    assert d["is_default"] is True


def test_default_is_exclusive(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    b = dp.add_preset("light.k", "Bright", {"brightness_pct": 90})
    dp.set_default("light.k", a["id"])
    dp.set_default("light.k", b["id"])
    defaults = [p for p in dp.list_presets("light.k") if p["is_default"]]
    assert len(defaults) == 1
    assert defaults[0]["id"] == b["id"]


def test_set_default_unknown_raises(dp):
    dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    with pytest.raises(KeyError):
        dp.set_default("light.k", "nope")


def test_clear_default(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    dp.set_default("light.k", a["id"])
    assert dp.clear_default("light.k") is True
    assert dp.get_default("light.k") is None
    assert dp.clear_default("light.k") is False  # nothing to clear now


def test_deleting_default_leaves_no_default(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    dp.set_default("light.k", a["id"])
    dp.delete_preset("light.k", a["id"])
    assert dp.get_default("light.k") is None


def test_default_survives_rename(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    dp.set_default("light.k", a["id"])
    dp.rename_preset("light.k", a["id"], "Snug")
    d = dp.get_default("light.k")
    assert d["id"] == a["id"] and d["name"] == "Snug" and d["is_default"] is True


def test_resolve_default_returns_settings_for_bare_turn_on(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40, "color_temp_kelvin": 2700})
    dp.set_default("light.k", a["id"])
    assert dp.resolve_default_turn_on("light.k", {}) == {"brightness_pct": 40, "color_temp_kelvin": 2700}
    assert dp.resolve_default_turn_on("light.k", {"entity_id": "light.k"}) == {"brightness_pct": 40, "color_temp_kelvin": 2700}


def test_resolve_default_yields_nothing_when_look_specified(dp):
    a = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    dp.set_default("light.k", a["id"])
    assert dp.resolve_default_turn_on("light.k", {"brightness_pct": 80}) == {}
    assert dp.resolve_default_turn_on("light.k", {"rgb_color": [1, 2, 3]}) == {}
    assert dp.resolve_default_turn_on("light.k", {"effect": "blink"}) == {}


def test_resolve_default_none_when_no_default(dp):
    dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    assert dp.resolve_default_turn_on("light.k", {}) == {}


def test_resolve_default_only_for_lights(dp):
    # A switch/other domain never gets a light default injected.
    assert dp.resolve_default_turn_on("switch.k", {}) == {}
    assert dp.resolve_default_turn_on(None, {}) == {}


def test_persistence_hits_disk(dp):
    # No in-memory cache: the store is the file. Prove the write landed on disk
    # and a fresh read (as a new process would do) sees it.
    p = dp.add_preset("light.k", "Cozy", {"brightness_pct": 40})
    import json
    with open(dp.STORE_FILE, "r", encoding="utf-8") as f:
        on_disk = json.load(f)
    assert on_disk["light.k"][0]["id"] == p["id"]
    assert dp.list_presets("light.k")[0]["name"] == "Cozy"
