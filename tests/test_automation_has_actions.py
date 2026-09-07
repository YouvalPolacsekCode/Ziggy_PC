"""An automation with no actions must never be saved, and Run must never
claim success for one.

Tslil's home, 2026-09-05: after a power cut he deleted his balcony motion
rules and rebuilt one in the wizard. It saved with ZERO actions. Home
Assistant fired it correctly on every motion event for two days — the trace
shows the trigger step and nothing after it — and Ziggy's Run button reported
"triggered" eight times in a row. The light never came on and nothing anywhere
said why.
"""
import pytest

from services import ha_automations as h


# ── has_executable_actions ───────────────────────────────────────────────────

def test_no_actions_is_not_executable():
    assert h.has_executable_actions({"name": "x", "actions": []}) is False
    assert h.has_executable_actions({"name": "x"}) is False


def test_plain_actions_are_executable():
    assert h.has_executable_actions(
        {"actions": [{"type": "call_service", "entity_id": "light.a", "service": "light.turn_on"}]}
    ) is True


def test_blueprint_native_body_counts():
    """Blueprint-sourced automations carry their steps in ha_native_body and
    legitimately have an empty Ziggy action list."""
    assert h.has_executable_actions(
        {"actions": [], "ha_native_body": {"actions": [{"service": "light.turn_on"}]}}
    ) is True
    assert h.has_executable_actions({"actions": [], "ha_native_body": {"actions": []}}) is False


def test_paired_stages_count():
    """Night Watch fans out into stages; the top-level action list is empty."""
    paired = {
        "paired": True,
        "actions": [],
        "stages": [{"name": "s1", "actions": []},
                   {"name": "s2", "actions": [{"type": "notify", "message": "hi"}]}],
    }
    assert h.has_executable_actions(paired) is True
    assert h.has_executable_actions({"paired": True, "stages": [{"actions": []}]}) is False


# ── save_automation refuses ──────────────────────────────────────────────────

def test_save_refuses_an_actionless_automation(monkeypatch):
    """The guard must fire before anything reaches Home Assistant."""
    def _boom(*a, **k):
        raise AssertionError("HA must not be called for an actionless automation")
    monkeypatch.setattr(h.requests, "post", _boom)

    res = h.save_automation({
        "name": "תאורת מרפסת",
        "trigger": {"type": "state", "entity_id": "binary_sensor.balcony", "state": "on"},
        "actions": [],
    })
    assert res["ok"] is False
    assert res["reason"] == "no_actions"
    assert res.get("error")


# ── resolve_run_target ───────────────────────────────────────────────────────

def test_run_target_prefers_ziggy_steps(monkeypatch):
    monkeypatch.setattr(h, "_saved_actions_for", lambda aid: [{"type": "ir_command"}])
    assert h.resolve_run_target("a1") == "ziggy"


def test_run_target_falls_back_to_ha_when_ha_owns_the_steps(monkeypatch):
    """A blueprint automation has no Ziggy-side steps but real HA actions —
    Run must hand it to HA rather than silently doing nothing."""
    monkeypatch.setattr(h, "_saved_actions_for", lambda aid: [])
    monkeypatch.setattr(h, "_ha_config_actions", lambda aid: [{"service": "light.turn_on"}])
    assert h.resolve_run_target("a1") == "ha"


def test_run_target_is_none_when_nobody_has_steps(monkeypatch):
    monkeypatch.setattr(h, "_saved_actions_for", lambda aid: [])
    monkeypatch.setattr(h, "_ha_config_actions", lambda aid: [])
    assert h.resolve_run_target("a1") == "none"
