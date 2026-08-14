"""A departure must be evidence, not silence — and not a stale fix either.

2026-08-14, Canary. Two failures in one day, opposite directions, same cause:

  * Leave Home fired at 13:49 and killed the AC on someone sitting in the
    living room. `sweep_expiry` had converted 30 minutes of silence into a
    committed `not_home`.
  * That morning the user really did leave at 07:15 and Leave Home never fired
    at all. `lan_grace` was vetoed by `gps_recent_home(person, 720)` — a fix up
    to TWELVE HOURS old counted as "still home", and the last fix before you
    walk out the door is always your living room.

The first fix attempted here was a 6-hour hold on `sweep_expiry` keyed on the
same stale-fix test. It stopped the false departure and made the real one
worse: both paths were then blocked for hours.

The actual problem is that "phone dozing at home" and "walked out" are the SAME
observation — LAN silent, GPS stale. No threshold separates them, because there
is no information to separate. The only thing that can is asking the phone.

So:
  * a FRESH fix inside the home zone still holds (direct evidence, no probe);
  * otherwise request a probe and hold;
  * if the phone answers, the answer decides;
  * if it does not answer within the grace, THAT is the departure.

Freshness is the load-bearing word. `gps_fresh_minutes` (12) is "is this
current?", not "have we heard anything today?".
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import presence_engine as pe


HOME_LAT, HOME_LON = 32.519459, 34.939181   # Canary's real home zone centre
NOW = datetime(2026, 8, 14, 13, 51, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(pe, "_home_zone", lambda: (HOME_LAT, HOME_LON, 80.0))
    # Journal to a temp file so tests never touch the real user_files.
    from services import presence_journal
    monkeypatch.setattr(presence_journal, "_PATH", tmp_path / "presence_events.jsonl")


def _person(*, last_seen, lat, lon, gps_at, lan_last_seen=None, state="home", **extra):
    p = {
        "id": "p1", "name": "Silentyouval", "state": state,
        "last_seen":     last_seen.isoformat(),
        "last_gps_at":   gps_at.isoformat() if gps_at else None,
        "last_lat":      lat, "last_lon": lon,
        "lan_last_seen": lan_last_seen.isoformat() if lan_last_seen else None,
        "history":       [],
    }
    p.update(extra)
    return p


def _at_home_but_silent(**extra):
    """The 13:51 record: last fix 12.9 m from home, 33 min old, LAN dead."""
    return _person(
        last_seen     = datetime(2026, 8, 14, 13, 17, 47, tzinfo=timezone.utc),
        gps_at        = datetime(2026, 8, 14, 13, 17, 47, tzinfo=timezone.utc),
        lat=32.5193634, lon=34.9391036,
        lan_last_seen = datetime(2026, 8, 14, 11, 38, 0, tzinfo=timezone.utc),
        **extra,
    )


def _sweep(monkeypatch, people, now=NOW):
    monkeypatch.setattr(pe, "_load", lambda: people)
    monkeypatch.setattr(pe, "_save", lambda _p: None)
    return pe.sweep_expiry(now=now)


class TestProbeBeforeDeciding:

    def test_silence_alone_requests_a_probe_instead_of_declaring_a_departure(self, monkeypatch):
        people = [_at_home_but_silent()]
        decisions = _sweep(monkeypatch, people)

        assert not [d for d in decisions if d.result == "committed"]
        assert people[0]["state"] == "home"
        assert people[0].get("departure_probe_pending") is True
        assert people[0].get("departure_probe_at")

    def test_it_waits_for_the_phone_within_the_grace(self, monkeypatch):
        asked = NOW - timedelta(seconds=60)
        people = [_at_home_but_silent(departure_probe_at=asked.isoformat())]
        decisions = _sweep(monkeypatch, people)

        assert not [d for d in decisions if d.result == "committed"]
        assert people[0]["state"] == "home"

    def test_an_unanswered_probe_IS_a_departure(self, monkeypatch):
        """The real 07:15 departure: phone gone, cannot be woken."""
        asked = NOW - timedelta(seconds=10_000)
        people = [_at_home_but_silent(departure_probe_at=asked.isoformat())]
        decisions = _sweep(monkeypatch, people)

        assert any(d.result == "committed" and d.reason == "ping_expired"
                   for d in decisions), \
            f"expected a departure, got {[(d.result, d.reason) for d in decisions]}"
        assert people[0]["state"] == "not_home"

    def test_the_probe_bookkeeping_is_cleared_once_it_decides(self, monkeypatch):
        asked = NOW - timedelta(seconds=10_000)
        people = [_at_home_but_silent(departure_probe_at=asked.isoformat())]
        _sweep(monkeypatch, people)
        assert "departure_probe_at" not in people[0]

    def test_a_fresh_answer_settles_the_open_question(self):
        """A real position ends the countdown — the phone replied."""
        p = _at_home_but_silent(departure_probe_at=NOW.isoformat(),
                                departure_probe_pending=True)
        pe.note_probe_answered(p)
        assert "departure_probe_at" not in p
        assert "departure_probe_pending" not in p


class TestFreshFixShortCircuits:

    def test_a_fresh_fix_inside_home_holds_without_probing(self, monkeypatch):
        people = [_person(
            last_seen = NOW - timedelta(minutes=2),
            gps_at    = NOW - timedelta(minutes=2),
            lat=32.5193634, lon=34.9391036,
        )]
        decisions = _sweep(monkeypatch, people)
        assert not [d for d in decisions if d.result == "committed"]
        assert people[0].get("departure_probe_pending") is None

    def test_a_STALE_fix_inside_home_does_NOT_hold_forever(self, monkeypatch):
        """The regression that stopped Leave Home firing. 2h old is not evidence."""
        people = [_at_home_but_silent(
            departure_probe_at=(NOW - timedelta(seconds=10_000)).isoformat())]
        decisions = _sweep(monkeypatch, people)
        assert any(d.result == "committed" for d in decisions), \
            "a two-hour-old fix must not veto a departure — that is what broke Leave Home"


class TestRealDepartureStillWorks:

    def test_last_fix_OUTSIDE_the_zone_needs_no_probe_at_all(self, monkeypatch):
        """Position already proves it. Don't wake the phone to confirm."""
        people = [_person(
            last_seen = NOW - timedelta(minutes=45),
            gps_at    = NOW - timedelta(minutes=45),
            lat=32.5400, lon=34.9600,            # ~3 km away
        )]
        decisions = _sweep(monkeypatch, people)
        assert any(d.result == "committed" and d.reason == "ping_expired"
                   for d in decisions)
        assert people[0]["state"] == "not_home"

    def test_no_position_at_all_still_probes_then_departs(self, monkeypatch):
        people = [_person(last_seen=NOW - timedelta(minutes=45),
                          gps_at=None, lat=None, lon=None)]
        first = _sweep(monkeypatch, people)
        assert not [d for d in first if d.result == "committed"]
        assert people[0].get("departure_probe_pending") is True

        people[0]["departure_probe_at"] = (NOW - timedelta(seconds=10_000)).isoformat()
        second = _sweep(monkeypatch, people)
        assert any(d.result == "committed" for d in second)


class TestDisplayStateIsUnaffected:
    def test_effective_state_still_decays_to_unknown(self):
        assert pe.effective_state(_at_home_but_silent(), now=NOW) == "unknown"


class TestPersistence:
    """A held round mutates the person; if it isn't saved the deadline is lost
    and the sweep re-probes forever without ever deciding."""

    def test_a_held_round_is_saved_even_though_it_emits_no_decision(self, monkeypatch):
        saved = []
        people = [_at_home_but_silent()]
        # Pre-mark a hold so _note_hold appends nothing to `out`.
        people[0]["history"] = [{"result": "held"}]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda p: saved.append(p))

        out = pe.sweep_expiry(now=NOW)
        assert out == []
        assert saved, "the probe deadline must be persisted or it is lost"
        assert people[0].get("departure_probe_at")

    def test_hold_marker_is_recorded_once_not_per_tick(self, monkeypatch):
        people = [_at_home_but_silent()]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)
        for minute in range(5):
            pe.sweep_expiry(now=NOW + timedelta(minutes=minute))
        held = [h for h in people[0]["history"] if h.get("result") == "held"]
        assert len(held) == 1


class TestJournal:
    def test_the_decision_chain_is_written_durably(self, monkeypatch):
        from services import presence_journal
        people = [_at_home_but_silent()]
        _sweep(monkeypatch, people)
        kinds = [r["kind"] for r in presence_journal.read(limit=50)]
        assert "departure_probe_requested" in kinds
        assert "departure_held" in kinds

    def test_a_confirmed_departure_is_written_durably(self, monkeypatch):
        from services import presence_journal
        people = [_at_home_but_silent(
            departure_probe_at=(NOW - timedelta(seconds=10_000)).isoformat())]
        _sweep(monkeypatch, people)
        kinds = [r["kind"] for r in presence_journal.read(limit=50)]
        assert "departure_confirmed" in kinds
