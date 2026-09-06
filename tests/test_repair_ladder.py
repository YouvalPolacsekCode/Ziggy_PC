"""services.repair_ladder — rung order, early stop, gates, rate limit, history, wording.

Every test injects executors: no HA, no MQTT, no PDP. The DB is a temp file
(same isolation pattern as tests/test_self_heal.py).
"""
import re
import time

import pytest

import services.repair_ladder as rl
from services import ha_zigbee as hz

_REAL_ENTITLED = rl._entitled      # captured before the autouse fixture patches it


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(rl, "_DB", tmp_path / "t.db")
    rl._db_ready = False
    # Entitled unless a test says otherwise.
    monkeypatch.setattr(rl, "_entitled", lambda: True)
    yield


class Fakes:
    """Scriptable executors; records every call in order."""

    def __init__(self, *, back_after=None, authz=None, reinterview_ok=True,
                 nudge_outcome="failed"):
        self.calls: list = []
        self.back_after = back_after          # rung name after which is_back → True
        self._done: set[str] = set()
        self.authz = authz or {}
        self.reinterview_ok = reinterview_ok
        self.nudge_outcome = nudge_outcome

    async def nudge_device(self, eid):
        self.calls.append("nudge_device"); self._done.add("nudge")
        return {"ok": True, "outcome": self.nudge_outcome, "state": "on"}

    async def nudge_sensor(self, eid):
        self.calls.append("nudge_sensor"); self._done.add("nudge")

    async def reinterview(self, eid):
        self.calls.append("reinterview"); self._done.add("reinterview")
        if self.reinterview_ok:
            return {"ok": True, "ieee": "0x00158d0001abcd12", "reason": ""}
        return {"ok": False, "ieee": None, "reason": "not_zigbee"}

    async def permit_join(self, seconds):
        self.calls.append(f"permit_join:{seconds}")
        return {"ok": True, "stack": "z2m"}

    async def is_back(self, eid):
        self.calls.append("is_back")
        return self.back_after is not None and self.back_after in self._done

    async def sleep(self, s):
        self.calls.append(f"sleep:{s}")

    def authz_check(self, action):
        self.calls.append(f"authz:{action}")
        # Default mirrors the real ladder: refresh=act, reinterview=confirm, repair=ask.
        default = {"system.refresh_device": (True, "act"),
                   "system.reinterview_device": (True, "confirm"),
                   "system.repair_device": (False, "ask")}
        return self.authz.get(action, default.get(action, (True, "open")))

    def as_dict(self):
        return {"nudge_device": self.nudge_device, "nudge_sensor": self.nudge_sensor,
                "reinterview": self.reinterview, "permit_join": self.permit_join,
                "is_back": self.is_back, "sleep": self.sleep,
                "authz_check": self.authz_check}


def _rungs(res):
    return [r["rung"] for r in res["rungs"]]


# ── rung ordering / early stop ────────────────────────────────────────────────
async def test_rung_order_when_nothing_fixes():
    f = Fakes()
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert _rungs(res) == ["nudge", "reinterview", "repair"]
    assert [r["outcome"] for r in res["rungs"]] == ["failed", "failed", "needs_owner"]
    assert res["fixed"] is False and res["next_step"] == "repair"
    # nudge runs before reinterview, which runs before the repair gate
    assert f.calls.index("nudge_device") < f.calls.index("reinterview")
    assert f.calls.index("reinterview") < f.calls.index("authz:system.repair_device")
    assert "sleep:8.0" in f.calls                      # settle before re-check
    assert not any(c.startswith("permit_join") for c in f.calls)


async def test_stops_at_first_fix_nudge_recovered():
    f = Fakes(nudge_outcome="recovered")
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert _rungs(res) == ["nudge"]
    assert res["rungs"][0]["outcome"] == "fixed"
    assert res["fixed"] is True and res["next_step"] is None
    assert "reinterview" not in f.calls


async def test_synced_without_fresh_report_is_not_a_fix():
    # manual_refresh_heal says "synced" whenever there is no recorded intent to
    # disagree with — including when HA is unreachable and state is None. A
    # silent device must not be declared fixed on that alone, or ANOM-13 would
    # never fire for a device nobody has commanded recently.
    f = Fakes(nudge_outcome="synced")
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert res["rungs"][0] == {"rung": "nudge", "outcome": "failed", "detail": "synced"}
    assert res["fixed"] is False
    assert "is_back" in f.calls            # reachability was actually checked
    # …but "synced" plus a fresh report IS a fix.
    g = Fakes(nudge_outcome="synced", back_after="nudge")
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=g.as_dict())
    assert res["fixed"] is True and _rungs(res) == ["nudge"]


async def test_stops_at_reinterview_when_it_brings_device_back():
    f = Fakes(back_after="reinterview")
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert _rungs(res) == ["nudge", "reinterview"]
    assert [r["outcome"] for r in res["rungs"]] == ["failed", "fixed"]
    assert res["fixed"] is True and res["next_step"] is None
    assert "authz:system.repair_device" not in f.calls


async def test_sensor_kind_uses_force_poll_then_recheck():
    f = Fakes(back_after="nudge")
    res = await rl.run_ladder("binary_sensor.office", trigger="ANOM-12", kind="sensor",
                              executors=f.as_dict())
    assert "nudge_sensor" in f.calls and "nudge_device" not in f.calls
    assert res["fixed"] is True and _rungs(res) == ["nudge"]
    assert res["rungs"][0]["detail"] == "force_poll"


async def test_bad_kind_rejected():
    with pytest.raises(ValueError):
        await rl.run_ladder("light.k", trigger="t", kind="thing", executors=Fakes().as_dict())


# ── reinterview skipped for non-Zigbee ────────────────────────────────────────
async def test_reinterview_skipped_for_non_zigbee():
    f = Fakes(reinterview_ok=False)
    res = await rl.run_ladder("switch.wifi_plug", trigger="ANOM-13", kind="device",
                              executors=f.as_dict())
    ri = next(r for r in res["rungs"] if r["rung"] == "reinterview")
    assert ri["outcome"] == "skipped" and ri["detail"] == "not_zigbee"
    assert "sleep:8.0" not in f.calls        # no settle wait when nothing was published
    assert res["next_step"] == "repair"


# ── repair rung obeys "ask" ───────────────────────────────────────────────────
async def test_repair_does_not_act_when_authz_says_ask():
    f = Fakes()
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    rep = next(r for r in res["rungs"] if r["rung"] == "repair")
    assert rep["outcome"] == "needs_owner" and rep["detail"] == "ask"
    assert not any(c.startswith("permit_join") for c in f.calls)
    assert res["next_step"] == "repair"


async def test_repair_opens_pairing_only_when_policy_allows():
    f = Fakes(authz={"system.repair_device": (True, "act")})
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    rep = next(r for r in res["rungs"] if r["rung"] == "repair")
    assert rep["outcome"] == "pairing_opened"
    assert "permit_join:60" in f.calls
    assert res["next_step"] == "repair"     # the owner still has to press the button


async def test_repair_never_opens_pairing_on_fail_open():
    # No PDP bootstrapped → authz.check returns (True, "open"). Nudge and
    # reinterview may run on that (they always ran unattended); opening a
    # pairing window from a background sweep may not.
    f = Fakes(authz={"system.refresh_device": (True, "open"),
                     "system.reinterview_device": (True, "open"),
                     "system.repair_device": (True, "open")})
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert "nudge_device" in f.calls and "reinterview" in f.calls
    rep = next(r for r in res["rungs"] if r["rung"] == "repair")
    assert rep == {"rung": "repair", "outcome": "needs_owner", "detail": "open"}
    assert not any(c.startswith("permit_join") for c in f.calls)
    assert res["next_step"] == "repair"


async def test_rungs_not_permitted_are_recorded_not_run():
    f = Fakes(authz={"system.refresh_device": (False, "ask"),
                     "system.reinterview_device": (False, "ask")})
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert [r["outcome"] for r in res["rungs"]] == ["not_permitted", "not_permitted", "needs_owner"]
    assert "nudge_device" not in f.calls and "reinterview" not in f.calls


async def test_executor_error_is_recorded_and_ladder_continues():
    f = Fakes()
    async def boom(eid):
        raise RuntimeError("HA down")
    ex = f.as_dict(); ex["nudge_device"] = boom
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=ex)
    assert res["rungs"][0] == {"rung": "nudge", "outcome": "error", "detail": "HA down"}
    assert "reinterview" in f.calls


# ── entitlement ───────────────────────────────────────────────────────────────
async def test_not_entitled_records_single_skip(monkeypatch):
    monkeypatch.setattr(rl, "_entitled", lambda: False)
    f = Fakes()
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert res["fixed"] is False and res["next_step"] == "physical"
    assert res["rungs"] == [{"rung": "ladder", "outcome": "skipped", "detail": "not_entitled"}]
    assert f.calls == []
    h = rl.history("light.k")
    assert len(h) == 1 and h[0]["outcome"] == "skipped" and h[0]["detail"] == "not_entitled"
    assert rl.describe_attempts(res, "en") == ""


def test_entitlement_fails_open_when_module_missing(monkeypatch):
    import builtins
    real_import = builtins.__import__
    def fake_import(name, *a, **k):
        if name == "services.entitlements" or (name == "services" and a and a[2] and "entitlements" in a[2]):
            raise ImportError("no entitlements yet")
        return real_import(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert _REAL_ENTITLED() is True


def test_entitlement_honours_module_when_present(monkeypatch):
    import sys, types
    import services
    mod = types.ModuleType("services.entitlements")
    mod.has = lambda feature: feature != "auto_repair"
    # `from services import entitlements` prefers the package attribute once the
    # real module has been imported anywhere in the run — patch both.
    monkeypatch.setitem(sys.modules, "services.entitlements", mod)
    monkeypatch.setattr(services, "entitlements", mod, raising=False)
    assert _REAL_ENTITLED() is False
    mod.has = lambda feature: True
    assert _REAL_ENTITLED() is True
    def broken(feature):
        raise RuntimeError("manifest unreadable")
    mod.has = broken
    assert _REAL_ENTITLED() is True            # errors fail open, like the subscription gate


# ── rate limit ────────────────────────────────────────────────────────────────
def test_should_run_respects_12h_rate_limit():
    now = time.time()
    assert rl.should_run("light.k", now=now) is True           # never attempted
    rl.record_attempt("light.k", "nudge", "failed", trigger="ANOM-13", ts=now - 3600)
    assert rl.should_run("light.k", now=now) is False          # 1 h since attempt
    assert rl.should_run("light.k", now=now + 10 * 3600 + 3599) is False   # 11h59m59s since
    assert rl.should_run("light.k", now=now + 11 * 3600) is True           # exactly 12 h since
    assert rl.should_run("light.other", now=now) is True       # per-entity


async def test_run_ladder_writes_rows_that_block_rerun():
    f = Fakes()
    await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=f.as_dict())
    assert rl.should_run("light.k") is False
    assert rl.should_run("light.k", now=time.time() + rl._RATE_LIMIT_S + 1) is True


# ── history / record round-trip ───────────────────────────────────────────────
def test_record_and_history_round_trip():
    t0 = time.time()
    rl.record_attempt("light.k", "nudge", "failed", detail="synced", trigger="ANOM-13", ts=t0 - 20)
    rl.record_attempt("light.k", "reinterview", "failed", detail="0x00158d0001abcd12",
                      trigger="ANOM-13", ts=t0 - 10)
    rl.record_attempt("light.k", "repair", "needs_owner", detail="ask", trigger="ANOM-13", ts=t0)
    rl.record_attempt("light.z", "nudge", "fixed", trigger="chat", ts=t0)

    h = rl.history("light.k")
    assert [r["rung"] for r in h] == ["repair", "reinterview", "nudge"]      # newest first
    assert h[0]["outcome"] == "needs_owner" and h[0]["trigger"] == "ANOM-13"
    assert h[2]["detail"] == "synced"
    assert all(r["entity_id"] == "light.k" for r in h)
    assert [r["rung"] for r in rl.history("light.k", limit=1)] == ["repair"]
    assert rl.last_attempt_ts("light.k") == pytest.approx(t0, abs=1e-3)
    assert rl.last_attempt_ts("light.nope") is None
    assert rl.history("light.nope") == []


def test_db_is_created_on_demand(tmp_path, monkeypatch):
    monkeypatch.setattr(rl, "_DB", tmp_path / "nested" / "dir" / "h.db")
    rl._db_ready = False
    rl.record_attempt("light.k", "nudge", "failed")
    assert (tmp_path / "nested" / "dir" / "h.db").exists()
    assert rl.history("light.k")[0]["outcome"] == "failed"


# ── describe_attempts wording ─────────────────────────────────────────────────
_BANNED_WORDS = ["home assistant", "zigbee", "coordinator", "integration", "mqtt",
                 "entity", "interview", "z2m", "ieee", "0x"]
_ENTITY_ID_RE = re.compile(
    r"\b(light|climate|switch|sensor|binary_sensor|fan|cover|lock|media_player)\.[a-z0-9_]")


def _assert_clean(text: str) -> None:
    low = text.lower()
    for w in _BANNED_WORDS:
        assert w not in low, f"jargon leaked: {w!r} in {text!r}"
    assert not _ENTITY_ID_RE.search(low), f"entity_id leaked in {text!r}"


async def _all_shapes():
    out = []
    out.append(await rl.run_ladder("light.0xabc", trigger="ANOM-13", kind="device",
                                   executors=Fakes().as_dict()))
    out.append(await rl.run_ladder("light.0xabc", trigger="ANOM-13", kind="device",
                                   executors=Fakes(nudge_outcome="recovered").as_dict()))
    out.append(await rl.run_ladder("light.0xabc", trigger="ANOM-13", kind="device",
                                   executors=Fakes(back_after="reinterview").as_dict()))
    out.append(await rl.run_ladder("switch.p", trigger="ANOM-13", kind="device",
                                   executors=Fakes(reinterview_ok=False).as_dict()))
    out.append(await rl.run_ladder("binary_sensor.s", trigger="ANOM-12", kind="sensor",
                                   executors=Fakes(authz={"system.repair_device": (True, "act")}).as_dict()))
    return out


async def test_describe_attempts_has_no_jargon_in_either_language():
    for res in await _all_shapes():
        for lang in ("en", "he"):
            _assert_clean(rl.describe_attempts(res, lang))


async def test_describe_attempts_english_wording():
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=Fakes().as_dict())
    assert rl.describe_attempts(res, "en") == "I tried waking it and reconnecting it — no luck."
    fixed = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device",
                                executors=Fakes(nudge_outcome="recovered").as_dict())
    assert rl.describe_attempts(fixed, "en") == "I tried waking it — it's back."
    only_nudge = await rl.run_ladder("switch.p", trigger="ANOM-13", kind="device",
                                     executors=Fakes(reinterview_ok=False).as_dict())
    assert rl.describe_attempts(only_nudge, "en") == "I tried waking it — no luck."


async def test_describe_attempts_hebrew_wording():
    res = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device", executors=Fakes().as_dict())
    assert rl.describe_attempts(res, "he") == "ניסיתי להעיר אותו ולחבר אותו מחדש — לא הצליח."
    fixed = await rl.run_ladder("light.k", trigger="ANOM-13", kind="device",
                                executors=Fakes(nudge_outcome="recovered").as_dict())
    assert rl.describe_attempts(fixed, "he") == "ניסיתי להעיר אותו — הוא חזר."


def test_describe_attempts_empty_when_nothing_tried():
    assert rl.describe_attempts({"rungs": [], "fixed": False}, "en") == ""
    nothing = {"rungs": [{"rung": "nudge", "outcome": "not_permitted", "detail": "ask"},
                         {"rung": "reinterview", "outcome": "skipped", "detail": "not_zigbee"},
                         {"rung": "repair", "outcome": "needs_owner", "detail": "ask"}],
               "fixed": False}
    assert rl.describe_attempts(nothing, "en") == ""
    assert rl.describe_attempts(nothing, "he") == ""


# ── _is_back cache semantics ──────────────────────────────────────────────────
def test_entry_is_back_rules():
    now = time.time()
    from datetime import datetime, timezone
    def iso(t): return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()
    assert rl._entry_is_back({"state": "on", "last_reported": iso(now - 30)}, now)
    assert rl._entry_is_back({"state": "off", "last_changed": iso(now - 100)}, now)
    assert not rl._entry_is_back({"state": "on", "last_reported": iso(now - 300)}, now)
    assert not rl._entry_is_back({"state": "unavailable", "last_reported": iso(now)}, now)
    assert not rl._entry_is_back({"state": "unknown", "last_reported": iso(now)}, now)
    assert not rl._entry_is_back({"state": "on"}, now)          # no timestamp = can't say back
    assert not rl._entry_is_back(None, now)


# ── Z2M identifier mapping (ha_zigbee helper) ─────────────────────────────────
def test_z2m_ieee_identifier_shapes():
    assert hz.z2m_ieee_from_device(
        {"identifiers": [["zigbee2mqtt", "0x00158D0001ABCD12"]]}) == "0x00158d0001abcd12"
    assert hz.z2m_ieee_from_device(
        {"identifiers": [["mqtt", "zigbee2mqtt_0x00158d0001abcd12"]]}) == "0x00158d0001abcd12"
    assert hz.z2m_ieee_from_device(
        {"identifiers": [("mqtt", "zigbee2mqtt_0x00158d0001abcd12")]}) == "0x00158d0001abcd12"
    # ZHA keeps the IEEE in connections — not Z2M, cannot be re-interviewed over MQTT
    assert hz.z2m_ieee_from_device(
        {"identifiers": [["zha", "00:15:8d:00:01:ab:cd:12"]],
         "connections": [["zigbee", "00:15:8d:00:01:ab:cd:12"]]}) is None
    # Non-Zigbee MQTT device (e.g. Ziggy's own presence sensor) → None
    assert hz.z2m_ieee_from_device({"identifiers": [["mqtt", "ziggy_presence"]]}) is None
    assert hz.z2m_ieee_from_device({"identifiers": [["tuya", "0x00158d0001abcd12"]]}) is None
    assert hz.z2m_ieee_from_device({}) is None


async def test_reinterview_entity_publishes_interview_request(monkeypatch):
    published = []
    async def fake_ws(msg):
        if msg["type"] == "config/entity_registry/list":
            return [{"result": [{"entity_id": "light.k", "device_id": "dev1"},
                                {"entity_id": "switch.w", "device_id": "dev2"},
                                {"entity_id": "sensor.orphan", "device_id": None}]}]
        if msg["type"] == "config/device_registry/list":
            return [{"result": [
                {"id": "dev1", "identifiers": [["mqtt", "zigbee2mqtt_0x00158d0001abcd12"]]},
                {"id": "dev2", "identifiers": [["tuya", "abc"]]},
            ]}]
        raise AssertionError(msg)
    async def fake_publish(topic, payload, qos=0):
        published.append((topic, payload))
    monkeypatch.setattr(hz, "_ws", fake_ws)
    monkeypatch.setattr(hz, "mqtt_publish", fake_publish)

    res = await hz.reinterview_entity("light.k")
    assert res == {"ok": True, "ieee": "0x00158d0001abcd12", "reason": ""}
    assert published == [("zigbee2mqtt/bridge/request/device/interview",
                          {"id": "0x00158d0001abcd12"})]

    for eid in ("switch.w", "sensor.orphan", "light.nope", ""):
        res = await hz.reinterview_entity(eid)
        assert res["ok"] is False and res["reason"] == "not_zigbee", eid
    assert len(published) == 1


async def test_reinterview_entity_reports_publish_failure(monkeypatch):
    async def fake_ws(msg):
        if msg["type"] == "config/entity_registry/list":
            return [{"result": [{"entity_id": "light.k", "device_id": "dev1"}]}]
        return [{"result": [{"id": "dev1", "identifiers": [["zigbee2mqtt", "0x00158d0001abcd12"]]}]}]
    async def broken_publish(topic, payload, qos=0):
        raise ConnectionError("broker down")
    monkeypatch.setattr(hz, "_ws", fake_ws)
    monkeypatch.setattr(hz, "mqtt_publish", broken_publish)
    res = await hz.reinterview_entity("light.k")
    assert res == {"ok": False, "ieee": "0x00158d0001abcd12", "reason": "publish_failed"}


# ── capability seed ───────────────────────────────────────────────────────────
def test_reinterview_capability_seeded():
    from services.permissions import seeds
    from services.permissions.types import RiskTier
    cap = next(c for c in seeds._SYSTEM if c.key == "system.reinterview_device")
    assert cap.risk_tier == RiskTier.MEDIUM
    assert "connectivity" in cap.scope_tags
