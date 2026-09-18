"""Alert doctrine: a home gets a daily budget of warning pushes. Past it, alerts
are still recorded and shown in the app, but the phone stays quiet. Critical
alerts always go through.

Why: on 2026-09-17 the Canary received ~134 pushes in a day, all but one false.
The one true alert (a bulb that had left the network) drowned. A tool that
cries wolf a hundred times gets muted the one time it is right.
"""
import pytest

from services import anomaly_engine as ae


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    ae._push_budget_state.clear()
    monkeypatch.setattr(ae, "_cfg", lambda: {"enabled": True, "daily_push_budget": 3})
    yield
    ae._push_budget_state.clear()


def test_budget_allows_then_suppresses_warnings():
    assert [ae._push_budget_ok("warning", now=1000.0) for _ in range(3)] == [True, True, True]
    assert ae._push_budget_ok("warning", now=1000.0) is False
    assert ae._push_budget_state["suppressed"] == 1


def test_critical_bypasses_budget():
    for _ in range(5):
        ae._push_budget_ok("warning", now=1000.0)
    assert ae._push_budget_ok("critical", now=1000.0) is True


def test_budget_resets_on_a_new_day():
    for _ in range(3):
        ae._push_budget_ok("warning", now=1000.0)
    assert ae._push_budget_ok("warning", now=1000.0) is False
    assert ae._push_budget_ok("warning", now=1000.0 + 86400) is True


def test_push_path_consults_budget(monkeypatch):
    sent = []
    import services.push_notify as pn
    monkeypatch.setattr(pn, "push_notify_fire_and_forget", lambda *a, **k: sent.append(a))
    monkeypatch.setattr(ae, "_log_history_fired", lambda *a, **k: None)
    rule = ae.AnomalyRule(rule_id="ANOM-99", scope="entity", severity="warning", cooldown_s=0, fn=lambda _: None)
    for i in range(5):
        ae._push_anomaly({}, f"room{i}", rule, ae.AnomalyResult(message=f"m{i}", confidence=0.9))
    assert len(sent) == 3
    assert ae.push_budget_status()["suppressed"] == 2
