"""
Regression coverage for the debug bus.

Three things must hold true for the Debug page to be trustworthy:

1. Level-gating is exact — at "basic", a verbose event MUST be dropped;
   at "off", nothing is emitted; at "trace", everything passes.
2. Scope filtering — when scopes are set, events outside that list are
   dropped; an empty scope list means "all scopes pass".
3. Sensitive fields are masked even when nested inside dicts/lists/tuples.
   A regression here would leak HA tokens or session keys into the buffer.

These are the invariants every router, service, and the FE-ingest endpoint
rely on; if they break, the whole structured-logging contract breaks.
"""
from core.debug_bus import DebugBus, BASIC, VERBOSE, TRACE


def _make_bus():
    return DebugBus(buffer_size=32)


# ── Level gating ──────────────────────────────────────────────────────────────

def test_off_drops_everything():
    bus = _make_bus()
    bus.set_level("off")
    assert bus.emit("intent", BASIC,   "x") is None
    assert bus.emit("intent", VERBOSE, "x") is None
    assert bus.emit("intent", TRACE,   "x") is None
    assert len(bus.get_events()) == 0


def test_basic_drops_verbose_and_trace():
    bus = _make_bus()
    bus.set_level("basic")
    assert bus.emit("intent", BASIC,   "kept")    is not None
    assert bus.emit("intent", VERBOSE, "dropped") is None
    assert bus.emit("intent", TRACE,   "dropped") is None
    events = bus.get_events()
    assert [e["step"] for e in events] == ["kept"]


def test_verbose_keeps_basic_and_verbose_drops_trace():
    bus = _make_bus()
    bus.set_level("verbose")
    bus.emit("intent", BASIC,   "b")
    bus.emit("intent", VERBOSE, "v")
    bus.emit("intent", TRACE,   "t")
    assert [e["step"] for e in bus.get_events()] == ["b", "v"]


def test_trace_keeps_everything():
    bus = _make_bus()
    bus.set_level("trace")
    bus.emit("intent", BASIC,   "b")
    bus.emit("intent", VERBOSE, "v")
    bus.emit("intent", TRACE,   "t")
    assert [e["step"] for e in bus.get_events()] == ["b", "v", "t"]


# ── Scope filtering ───────────────────────────────────────────────────────────

def test_empty_scopes_lets_everything_through():
    bus = _make_bus()
    bus.set_level("trace")
    bus.set_scopes([])
    bus.emit("intent", BASIC, "i")
    bus.emit("ha",     BASIC, "h")
    bus.emit("ir",     BASIC, "r")
    assert len(bus.get_events()) == 3


def test_scope_list_filters_out_other_scopes():
    bus = _make_bus()
    bus.set_level("trace")
    bus.set_scopes(["intent", "ha"])
    bus.emit("intent", BASIC, "kept_intent")
    bus.emit("ha",     BASIC, "kept_ha")
    bus.emit("ir",     BASIC, "dropped_ir")
    bus.emit("voice",  BASIC, "dropped_voice")
    steps = sorted(e["step"] for e in bus.get_events())
    assert steps == ["kept_ha", "kept_intent"]


# ── Sensitive-field masking ──────────────────────────────────────────────────

def test_mask_top_level_token():
    bus = _make_bus()
    bus.set_level("basic")
    bus.emit("ha", BASIC, "x", token="should-never-appear", entity_id="light.kitchen")
    ev = bus.get_events()[-1]
    assert ev["data"]["token"]     == "••••••••"
    assert ev["data"]["entity_id"] == "light.kitchen"


def test_mask_inside_nested_dict_and_list():
    bus = _make_bus()
    bus.set_level("basic")
    bus.emit(
        "ha", BASIC, "x",
        payload={
            "headers": {"Authorization": "Bearer secret-jwt", "X-Trace": "abc"},
            "rows": [{"password": "p", "ok": True}],
        },
    )
    data = bus.get_events()[-1]["data"]
    assert data["payload"]["headers"]["Authorization"] == "••••••••"
    assert data["payload"]["headers"]["X-Trace"]       == "abc"
    assert data["payload"]["rows"][0]["password"]      == "••••••••"
    assert data["payload"]["rows"][0]["ok"]            is True


def test_mask_does_not_strip_safe_keys_like_id_or_name():
    bus = _make_bus()
    bus.set_level("basic")
    bus.emit("device", BASIC, "x", entity_id="light.kitchen", name="Living Room")
    data = bus.get_events()[-1]["data"]
    assert data["entity_id"] == "light.kitchen"
    assert data["name"]      == "Living Room"


# ── get_events filters ────────────────────────────────────────────────────────

def test_get_events_filters_by_request_id_and_result():
    bus = _make_bus()
    bus.set_level("basic")
    bus.emit("api", BASIC, "request_completed",
             request_id="r_abc", method="POST", path="/x",
             status=200, result="ok")
    bus.emit("api", BASIC, "request_completed",
             request_id="r_xyz", method="POST", path="/x",
             status=500, result="server_error")

    only_abc = bus.get_events(request_id="r_abc")
    assert len(only_abc) == 1 and only_abc[0]["request_id"] == "r_abc"

    only_errors = bus.get_events(result="server_error")
    assert len(only_errors) == 1 and only_errors[0]["data"]["result"] == "server_error"


# ── Never raise ────────────────────────────────────────────────────────────────

def test_emit_swallows_bad_data():
    """A bad payload must NEVER crash the caller — that's the whole point of
    the try/except inside emit()."""
    bus = _make_bus()
    bus.set_level("trace")

    class Boom:
        def __repr__(self):
            raise RuntimeError("nope")
    # _sanitize doesn't call repr(), but uuid.uuid4 etc. paths might. The
    # contract is "never raise"; this just exercises the safety net.
    bus.emit("ha", BASIC, "x", thing=Boom())
    # If we got here without exception, we're good.
