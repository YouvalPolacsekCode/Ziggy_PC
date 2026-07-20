"""Unit tests for the Smart Climate hysteresis engine (pure decision logic).

Covers the thermostat state machine: crossing up/down, deadband no-flap,
last-gating (Ziggy only toggles from its own state → never fights a manual
change, only turns off what it turned on), heating direction inverted,
force/Sync-now, and edge validation/deadband enforcement.
"""
from services import smart_climate_engine as eng

COOL = {"device": {"kind": "ir_ac", "id": "ac1"}, "on": 25, "off": 24}
HEAT = {"device": {"kind": "ir_ac", "id": "ac1"}, "on": 19, "off": 20}


# ── cooling ──────────────────────────────────────────────────────────────────

def test_cool_turns_on_when_hot():
    assert eng.decide(25, COOL, "cool", last="off") == "on"
    assert eng.decide(26, COOL, "cool", last=None) == "on"


def test_cool_turns_off_when_cool():
    assert eng.decide(24, COOL, "cool", last="on") == "off"
    assert eng.decide(23, COOL, "cool", last="on") == "off"


def test_cool_deadband_is_noop():
    # Between off (24) and on (25): no strong opinion → never flaps.
    assert eng.decide(24.5, COOL, "cool", last="off") is None
    assert eng.decide(24.5, COOL, "cool", last="on") is None


def test_cool_last_gating_no_repeat():
    # Already on and still hot → don't re-fire on.
    assert eng.decide(26, COOL, "cool", last="on") is None
    # Already off and still cool → don't re-fire off.
    assert eng.decide(23, COOL, "cool", last="off") is None


# ── heating (direction inverted) ─────────────────────────────────────────────

def test_heat_turns_on_when_cold():
    assert eng.decide(19, HEAT, "heat", last="off") == "on"
    assert eng.decide(17, HEAT, "heat", last=None) == "on"


def test_heat_turns_off_when_warm():
    assert eng.decide(20, HEAT, "heat", last="on") == "off"
    assert eng.decide(22, HEAT, "heat", last="on") == "off"


def test_heat_deadband_is_noop():
    assert eng.decide(19.5, HEAT, "heat", last="off") is None
    assert eng.decide(19.5, HEAT, "heat", last="on") is None


# ── manual-respect (the crux) ────────────────────────────────────────────────

def test_only_turns_off_what_it_turned_on():
    # User hand-started the AC while Ziggy thinks it's off, room in-band/cool.
    # Ziggy must NOT immediately kill it: "temp ≤ off and last != off" is false
    # because last is already "off".
    assert eng.decide(23, COOL, "cool", last="off") is None


def test_respects_manual_off():
    # Ziggy had it on; user switched it off by hand (last stays "on"), still hot.
    # Ziggy must not force it back on: "temp ≥ on and last != on" is false.
    assert eng.decide(26, COOL, "cool", last="on") is None


# ── force / Sync now ─────────────────────────────────────────────────────────

def test_force_overrides_last_gate():
    # Sync now asserts the wanted state even if it equals last.
    assert eng.decide(26, COOL, "cool", last="on", force=True) == "on"
    assert eng.decide(23, COOL, "cool", last="off", force=True) == "off"


def test_force_still_respects_deadband():
    # No wanted state inside the deadband, even under force — nothing to assert.
    assert eng.decide(24.5, COOL, "cool", last="on", force=True) is None


# ── safety / degenerate ──────────────────────────────────────────────────────

def test_no_reading_is_noop():
    assert eng.decide(None, COOL, "cool", last="off") is None


def test_no_edge_is_noop():
    assert eng.decide(26, None, "cool", last="off") is None


def test_boundary_equality_counts_as_crossing():
    # Exactly on the on-point should turn on; exactly on the off-point should off.
    assert eng.decide(25.0, COOL, "cool", last="off") == "on"
    assert eng.decide(24.0, COOL, "cool", last="on") == "off"


# ── edge validation / deadband enforcement ───────────────────────────────────

def test_clean_edge_enforces_cooling_gap():
    # Inverted cooling band (on <= off) gets a real gap forced.
    e = eng._clean_edge({"device": {"kind": "ir_ac", "id": "ac1"}, "on": 24, "off": 25}, "cool")
    assert e["on"] > e["off"]


def test_clean_edge_enforces_heating_gap():
    e = eng._clean_edge({"device": {"kind": "ir_ac", "id": "ac1"}, "on": 20, "off": 19}, "heat")
    assert e["on"] < e["off"]


def test_clean_edge_rejects_deviceless():
    assert eng._clean_edge({"on": 25, "off": 24}, "cool") is None
    assert eng._clean_edge(None, "cool") is None


def test_clean_edge_defaults_bad_numbers():
    e = eng._clean_edge({"device": {"kind": "fan", "id": "fan.x"}, "on": "hot", "off": None}, "cool")
    assert e["on"] == 25 and e["off"] == 24  # COOL_DEFAULTS


# ── average reading ──────────────────────────────────────────────────────────

def test_room_temp_single(monkeypatch):
    monkeypatch.setattr(eng, "_read_one", lambda s: {"sensor.a": 25.0}.get(s))
    assert eng.room_temp({"sensor": "sensor.a"}) == 25.0


def test_room_temp_average(monkeypatch):
    vals = {"sensor.a": 24.0, "sensor.b": 26.0}
    monkeypatch.setattr(eng, "_read_one", lambda s: vals.get(s))
    assert eng.room_temp({"sensor": "sensor.a", "sensors": ["sensor.a", "sensor.b"]}) == 25.0


def test_room_temp_average_skips_offline(monkeypatch):
    vals = {"sensor.a": 30.0, "sensor.b": None}   # b offline
    monkeypatch.setattr(eng, "_read_one", lambda s: vals.get(s))
    assert eng.room_temp({"sensors": ["sensor.a", "sensor.b"]}) == 30.0


def test_room_temp_average_all_offline(monkeypatch):
    monkeypatch.setattr(eng, "_read_one", lambda s: None)
    assert eng.room_temp({"sensors": ["sensor.a", "sensor.b"]}) is None
