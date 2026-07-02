"""Acceptance test for the flagship pattern-learned suggestion (Item 6).

The proactive story: "You turn off the AC manually every night around 02:00 —
want me to automate that?". This exercises the FULL existing pipeline end to
end against synthetic events (no real event log, no HA):

    events → detect_patterns → qualified time_based candidate →
    suggestion_engine conversion → a time-triggered 'turn AC off at 02:00'
    automation proposal.

It locks the flagship behavior in so a future refactor of the detector or the
suggestion converter can't silently drop it.
"""
import importlib
from datetime import datetime, timedelta
from pathlib import Path

import pytest


@pytest.fixture
def pd(tmp_path, monkeypatch):
    mod = importlib.import_module("services.pattern_detector")
    # Isolate the candidate store + ignore any real event log.
    monkeypatch.setattr(mod, "CANDIDATES_FILE", Path(tmp_path) / "cand.json")
    monkeypatch.setattr(mod, "load_events", lambda lookback_days=30: [])
    # No device registry in tests — treat cached entity_ids as known so the
    # stale-entity gate doesn't drop the candidate.
    monkeypatch.setattr(mod, "_entity_id_is_known", lambda eid: True)
    return mod


def _nightly_ac_off_events(n=12, step_days=2):
    """n manual 'AC off' events, one every `step_days` nights, all ~02:00.

    Spans n*step_days days → comfortably clears the ≥3 unique weeks / ≥3 unique
    days / ≥5 occurrences evidence gate, and ends 'today' so recency is high.
    """
    now = datetime.now()
    out = []
    for i in range(n):
        day = now - timedelta(days=i * step_days)
        ts = day.replace(hour=2, minute=(i % 4), second=0, microsecond=0)
        out.append({
            "intent": "control_ac",
            "room": "bedroom",
            "action": "off",
            "ts": ts.isoformat(timespec="seconds"),
            "result": "ok",
            "automatable": True,
            "reversed": False,
        })
    return out


def test_flagship_ac_off_at_2am_becomes_time_triggered_automation(pd):
    qualified = pd.detect_patterns(_nightly_ac_off_events())

    ac = [c for c in qualified if c.intent == "control_ac" and c.action == "off"]
    assert ac, (
        "expected a flagship 'AC off ~02:00' candidate; got "
        f"{[(c.intent, c.action, round(c.confidence, 2)) for c in qualified]}"
    )
    c = ac[0]
    assert c.pattern_type == "time_based"
    assert c.details.get("avg_hour") == 2
    assert c.confidence >= 0.65  # CONFIDENCE_THRESHOLD

    # Suggestion conversion: a time trigger near 02:00 + an AC-off action.
    from services.suggestion_engine import (
        _default_trigger, _default_actions, _heuristic_reason,
    )
    trig = _default_trigger(c)
    assert trig["type"] == "time" and trig["value"].startswith("02:")

    acts = _default_actions(c)
    assert acts and acts[0]["intent"] == "control_ac"
    assert acts[0]["params"]["turn_on"] is False

    reason = _heuristic_reason(c)
    assert "02:" in reason  # cites the observed time window / avg time


def test_below_threshold_evidence_does_not_qualify(pd):
    # Only 3 occurrences, one week → fails the evidence gate, no suggestion.
    few = _nightly_ac_off_events(n=3, step_days=1)
    qualified = pd.detect_patterns(few)
    assert not [c for c in qualified if c.intent == "control_ac"]
