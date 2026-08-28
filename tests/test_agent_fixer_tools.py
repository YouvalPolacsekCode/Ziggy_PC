"""Layer-A fixer tools — the agent's eyes/hands for a misbehaving home.

Every tool result (message AND structured data) must reach the model already
jargon-free: the model must never be handed a raw ISSUE_/entity_id it could
parrot back to the user (feedback_ziggy_product_surface).
"""
import json
import re

import pytest

from core.agent import tools as T
from services import ha_health as H

_BANNED_WORDS = [
    "home assistant", "zigbee", "coordinator", "integration", "mqtt", "entity",
    # raw issue codes must not survive into the model-facing result
    "coordinator_setup_failed", "devices_offline", "ha_unreachable",
]
# A real entity_id is lowercase "domain.identifier" — match that, NOT a proper
# device name like "Entry Light." (name + punctuation).
_ENTITY_ID_RE = re.compile(
    r"\b(light|climate|switch|sensor|binary_sensor|fan|cover|lock|media_player)\.[a-z0-9_]")


def _assert_clean(blob: str) -> None:
    low = blob.lower()
    for w in _BANNED_WORDS:
        assert w not in low, f"jargon leaked: {w!r} in {blob!r}"
    assert not _ENTITY_ID_RE.search(low), f"entity_id leaked in {blob!r}"


@pytest.mark.asyncio
async def test_check_home_health_translates_and_hides_jargon(monkeypatch):
    async def fake_snapshot():
        return {"level": H.LEVEL_DOWN, "primary": H.ISSUE_COORDINATOR_FAILED,
                "devices": {"total": 10, "offline": 8}}
    monkeypatch.setattr(H, "health_snapshot", fake_snapshot)

    res = await T.execute_tool("check_home_health", {}, directory={}, lang="en")

    assert res["ok"] is True
    assert res["message"].strip(), "expected a human summary line"
    assert res["data"]["severity"] == "problem"
    assert res["data"]["offline_count"] == 8
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_check_home_health_ok_state_is_reassuring(monkeypatch):
    async def fake_snapshot():
        return {"level": H.LEVEL_OK, "primary": H.ISSUE_OK,
                "devices": {"total": 5, "offline": 0}}
    monkeypatch.setattr(H, "health_snapshot", fake_snapshot)

    res = await T.execute_tool("check_home_health", {}, directory={}, lang="he")

    assert res["ok"] is True
    assert res["data"]["severity"] == "ok"
    assert res["data"]["offline_count"] == 0
    _assert_clean(json.dumps(res, ensure_ascii=False))


# ── fixtures ─────────────────────────────────────────────────────────────────
def _directory_with_lamp():
    return {"devices": [{
        "entity_id": "light.living_room", "name": "living room lamp",
        "room": "living_room", "domain": "light", "state": "on", "on": True,
        "he_noun": "המנורה", "room_he": "סלון",
    }]}


# ── refresh_device (auto-safe: do it and tell them) ──────────────────────────
@pytest.mark.asyncio
async def test_refresh_device_names_device_and_reports_recovery(monkeypatch):
    from services import self_heal

    async def fake_heal(eid):
        assert eid == "light.living_room"
        return {"ok": True, "outcome": "recovered", "state": "on"}
    monkeypatch.setattr(self_heal, "manual_refresh_heal", fake_heal)

    res = await T.execute_tool("refresh_device", {"entity_id": "light.living_room"},
                               directory=_directory_with_lamp(), lang="en")

    assert res["ok"] is True
    assert "living room lamp" in res["message"], "should name the device to the user"
    assert res["data"]["fixed"] is True
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_refresh_device_unknown_device_is_gentle(monkeypatch):
    res = await T.execute_tool("refresh_device", {"entity_id": "light.nope"},
                               directory=_directory_with_lamp(), lang="en")
    assert res["ok"] is False
    assert res.get("no_such_device") is True
    _assert_clean(json.dumps(res, ensure_ascii=False))


# ── recover_connectivity (auto-safe reconnect; must not leak raw jargon msg) ──
@pytest.mark.asyncio
async def test_recover_connectivity_success_is_clean(monkeypatch):
    from services import ha_health as HH

    async def fake_recover():
        return {"ok": True, "already_healthy": True,
                "message": "Smart home system looks healthy."}
    monkeypatch.setattr(HH, "trigger_recover_now", fake_recover)

    res = await T.execute_tool("recover_connectivity", {}, directory={}, lang="he")
    assert res["ok"] is True
    assert res["data"]["outcome"] == "healthy"
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_recover_connectivity_failure_translates_replug_not_raw_jargon(monkeypatch):
    from services import ha_health as HH

    async def fake_recover():
        # NOTE: raw message is full of jargon — it must NOT survive to the model.
        return {"ok": False, "result": "failed", "manual_action": "replug_zigbee_dongle",
                "message": "Reconnect didn't fix it. Please unplug the Zigbee USB dongle..."}
    monkeypatch.setattr(HH, "trigger_recover_now", fake_recover)

    res = await T.execute_tool("recover_connectivity", {}, directory={}, lang="en")
    assert res["data"]["outcome"] == "needs_replug"
    assert res["message"].strip()
    _assert_clean(json.dumps(res, ensure_ascii=False))


# ── diagnose_pairing (north-star #2: "why won't my new device connect?") ────
@pytest.mark.asyncio
async def test_diagnose_pairing_explains_a_stalled_device_without_jargon(monkeypatch):
    from services import pairing_doctor as pd

    async def fake_diag():
        return {"verdict": "stalled", "radio_ok": True, "pairing_open": True,
                "stalled_names": ["Front Door Sensor"], "pending_names": []}
    monkeypatch.setattr(pd, "diagnose_pairing", fake_diag)

    res = await T.execute_tool("diagnose_pairing", {}, directory={}, lang="he")

    assert res["ok"] is True
    assert res["data"]["kind"] == "pairing_diagnosis"
    assert res["data"]["verdict"] == "stalled"
    assert "Front Door Sensor" in res["message"]
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_diagnose_pairing_reports_a_wedged_radio_cleanly(monkeypatch):
    from services import pairing_doctor as pd

    async def fake_diag():
        return {"verdict": "radio_down", "radio_ok": False, "pairing_open": None,
                "stalled_names": [], "pending_names": []}
    monkeypatch.setattr(pd, "diagnose_pairing", fake_diag)

    res = await T.execute_tool("diagnose_pairing", {}, directory={}, lang="en")

    assert res["data"]["verdict"] == "radio_down"
    _assert_clean(json.dumps(res, ensure_ascii=False))


def test_diagnose_pairing_is_offered_to_the_model():
    names = [s["function"]["name"] for s in T.TOOL_SCHEMAS]
    assert "diagnose_pairing" in names
    schema = next(s for s in T.TOOL_SCHEMAS if s["function"]["name"] == "diagnose_pairing")
    _assert_clean(json.dumps(schema, ensure_ascii=False))


# ── the PDP gate: state-changing fixes ask the policy engine first ──────────
#
# The gate lives BELOW the model: a hijacked prompt can still call the tool, but
# the tool won't act unless policy says it may.


@pytest.fixture
def gate_calls(monkeypatch):
    """Record every authz.check() the tools make; allow by default."""
    from core.agent import authz
    calls = []

    def fake_check(action, resource=None, *, on_behalf_of=None,
                   explicit_confirm=False, context=None):
        calls.append({"action": action, "on_behalf_of": on_behalf_of})
        return calls_allow[0], calls_mode[0]

    calls_allow = [True]
    calls_mode = ["act"]
    monkeypatch.setattr(authz, "check", fake_check)
    return {"calls": calls, "allow": calls_allow, "mode": calls_mode}


@pytest.mark.asyncio
async def test_refresh_device_asks_the_gate_for_the_refresh_capability(monkeypatch, gate_calls):
    from services import self_heal

    async def fake_heal(eid):
        return {"ok": True, "outcome": "recovered", "state": "on"}
    monkeypatch.setattr(self_heal, "manual_refresh_heal", fake_heal)

    res = await T.execute_tool("refresh_device", {"entity_id": "light.living_room"},
                               directory=_directory_with_lamp(), lang="en",
                               actor="person:youval")

    assert res["data"]["fixed"] is True, "an allowed fix must still run"
    assert gate_calls["calls"] == [
        {"action": "system.refresh_device", "on_behalf_of": "person:youval"}]


@pytest.mark.asyncio
async def test_refresh_device_does_not_act_when_policy_says_no(monkeypatch, gate_calls):
    from services import self_heal
    healed = []

    async def fake_heal(eid):
        healed.append(eid)
        return {"ok": True, "outcome": "recovered", "state": "on"}
    monkeypatch.setattr(self_heal, "manual_refresh_heal", fake_heal)
    gate_calls["allow"][0], gate_calls["mode"][0] = False, "ask"

    res = await T.execute_tool("refresh_device", {"entity_id": "light.living_room"},
                               directory=_directory_with_lamp(), lang="en")

    assert healed == [], "must not touch the device without permission"
    assert res["data"]["kind"] == "needs_approval"
    assert res["message"].strip(), "must tell the user it needs their OK"
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_blocked_refresh_speaks_hebrew_without_jargon(monkeypatch, gate_calls):
    gate_calls["allow"][0], gate_calls["mode"][0] = False, "ask"
    res = await T.execute_tool("refresh_device", {"entity_id": "light.living_room"},
                               directory=_directory_with_lamp(), lang="he")
    assert res["data"]["kind"] == "needs_approval"
    assert any("א" <= c <= "ת" for c in res["message"]), "Hebrew turn → Hebrew answer"
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_recover_connectivity_asks_the_gate_for_the_reconnect_capability(
        monkeypatch, gate_calls):
    from services import ha_health as HH

    async def fake_recover():
        return {"ok": True, "already_healthy": True}
    monkeypatch.setattr(HH, "trigger_recover_now", fake_recover)

    res = await T.execute_tool("recover_connectivity", {}, directory={}, lang="en",
                               actor="person:youval")

    assert res["data"]["outcome"] == "healthy"
    assert gate_calls["calls"] == [
        {"action": "system.reload_coordinator", "on_behalf_of": "person:youval"}]


@pytest.mark.asyncio
async def test_recover_connectivity_does_not_act_when_policy_says_no(monkeypatch, gate_calls):
    from services import ha_health as HH
    tried = []

    async def fake_recover():
        tried.append(1)
        return {"ok": True}
    monkeypatch.setattr(HH, "trigger_recover_now", fake_recover)
    gate_calls["allow"][0], gate_calls["mode"][0] = False, "ask"

    res = await T.execute_tool("recover_connectivity", {}, directory={}, lang="he")

    assert tried == [], "must not reconnect without permission"
    assert res["data"]["kind"] == "needs_approval"
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_read_only_tools_are_not_gated(monkeypatch, gate_calls):
    """Diagnosis must never need permission — it's the thing that explains the home."""
    from services import down_device_detector as dd
    monkeypatch.setattr(dd, "find_down_devices", lambda stale_hours=48.0: [])

    await T.execute_tool("diagnose_device", {"entity_id": "light.living_room"},
                         directory=_directory_with_lamp(), lang="en")
    await T.execute_tool("list_down_devices", {}, directory={}, lang="en")

    assert gate_calls["calls"] == []


# ── who the agent is acting for must survive the whole chat path ────────────
#
# Without this the delegation clamp is dead code: the PDP would only ever see
# the agent's own envelope, never the human's.


@pytest.mark.asyncio
async def test_runner_hands_the_chat_user_down_to_the_tools(monkeypatch):
    from core.agent import runner

    class _Fn:
        name = "check_home_health"
        arguments = "{}"

    class _Call:
        id = "call_1"
        function = _Fn()

    class _Msg:
        content = ""
        tool_calls = [_Call()]

    class _Resp:
        choices = [type("C", (), {"message": _Msg()})()]

    replies = [_Resp(), type("R2", (), {"choices": [
        type("C", (), {"message": type("M", (), {"content": "all good", "tool_calls": []})()})()]})()]
    monkeypatch.setattr(runner, "chat_completion", lambda *a, **k: replies.pop(0))
    monkeypatch.setattr(runner, "require_cloud_llm_active", lambda: None)

    async def fake_dir():
        return {"devices": [], "presence": [], "by_room": {}}
    monkeypatch.setattr(runner._dir, "build_directory", fake_dir)

    seen = {}

    async def fake_exec(name, args, directory, lang="en", actor=None):
        seen["actor"] = actor
        return {"ok": True, "message": "fine"}
    monkeypatch.setattr(runner._tools, "execute_tool", fake_exec)

    await runner.run_agent("is everything ok?", None, actor="person:youval")

    assert seen["actor"] == "person:youval"


@pytest.mark.asyncio
async def test_chat_route_hands_the_authenticated_caller_to_the_agent(monkeypatch):
    from backend.routers import intent_router as ir
    from core.agent import runner

    seen = {}

    async def fake_run_agent(text, history, *, channel="chat", actor=None):
        seen["actor"] = actor
        return {"ok": True, "message": "done"}
    monkeypatch.setattr(runner, "run_agent", fake_run_agent)

    await ir._compute_reply("fix the light", None, "web", "v2", "person:youval", "req1")

    assert seen["actor"] == "person:youval"


# ── diagnose_device (read-only fact-gathering for the agent to reason on) ────
@pytest.mark.asyncio
async def test_diagnose_device_reports_mismatch_clean(monkeypatch):
    from services import command_ledger, self_heal

    monkeypatch.setattr(command_ledger, "get_last",
                        lambda eid: {"state": "on", "origin": "user", "ts": 0})
    monkeypatch.setattr(self_heal, "get_log", lambda limit=100: [])

    directory = _directory_with_lamp()
    directory["devices"][0]["state"] = "off"     # user asked on, it's off
    directory["devices"][0]["on"] = False

    res = await T.execute_tool("diagnose_device", {"entity_id": "light.living_room"},
                               directory=directory, lang="en")
    assert res["ok"] is True
    assert res["data"]["kind"] == "device_diagnosis"
    assert res["data"]["last_intended"] == "on"
    assert res["data"]["is_on"] is False
    _assert_clean(json.dumps(res, ensure_ascii=False))


# ── acknowledge_alerts (explicit user 'it's fine') ───────────────────────────
@pytest.mark.asyncio
async def test_acknowledge_alerts_clean(monkeypatch):
    from services import ha_health as HH
    monkeypatch.setattr(HH, "acknowledge_offline",
                        lambda ids: {"ok": True, "acknowledged_count": len(ids)})
    res = await T.execute_tool("acknowledge_alerts", {}, directory={}, lang="he")
    assert res["ok"] is True
    _assert_clean(json.dumps(res, ensure_ascii=False))


# ── list_down_devices (proactive detector, exposed to the agent) ─────────────
@pytest.mark.asyncio
async def test_list_down_devices_translates_and_hides_ids(monkeypatch):
    from services import down_device_detector as dd
    monkeypatch.setattr(dd, "find_down_devices", lambda stale_hours=48.0: [
        {"entity_id": "light.0xAAA", "name": "Entry Light", "domain": "light",
         "state": "off", "silent_hours": 336.0}])
    res = await T.execute_tool("list_down_devices", {}, directory={}, lang="he")
    assert res["ok"] is True
    assert res["data"]["count"] == 1
    assert "Entry Light" in res["message"]
    # entity_ids must NOT reach the model-facing result
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_list_down_devices_none_is_reassuring(monkeypatch):
    from services import down_device_detector as dd
    monkeypatch.setattr(dd, "find_down_devices", lambda stale_hours=48.0: [])
    res = await T.execute_tool("list_down_devices", {}, directory={}, lang="he")
    assert res["ok"] is True and res["data"]["count"] == 0
    _assert_clean(json.dumps(res, ensure_ascii=False))


# ── explain_device_change (causal trace — 'what turned my light off?') ───────
@pytest.mark.asyncio
async def test_explain_device_change_names_the_automation(monkeypatch):
    from services import cause_tracer
    monkeypatch.setattr(cause_tracer, "fetch_logbook", lambda eid, hours=48: [
        {"entity_id": "light.living_room", "state": "off",
         "when": "2026-08-28T23:00:00+00:00",
         "context_domain": "automation", "context_name": "Good Night"}])
    res = await T.execute_tool("explain_device_change",
                               {"entity_id": "light.living_room", "action": "off"},
                               directory=_directory_with_lamp(), lang="he")
    assert res["ok"] is True
    assert "Good Night" in res["message"]
    assert res["data"]["cause_kind"] == "automation"
    _assert_clean(json.dumps(res, ensure_ascii=False))


@pytest.mark.asyncio
async def test_explain_device_change_unknown_device_is_gentle(monkeypatch):
    res = await T.execute_tool("explain_device_change", {"entity_id": "light.nope"},
                               directory=_directory_with_lamp(), lang="en")
    assert res["ok"] is False and res.get("no_such_device") is True
    _assert_clean(json.dumps(res, ensure_ascii=False))
