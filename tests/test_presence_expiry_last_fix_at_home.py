"""A stale ping is "no news", not "you left".

2026-08-14, Canary. Leave Home ran at 13:49:27 and killed the living-room AC
while Youval sat in that room. It was allowed to run because Ziggy's presence
engine had decided he was away — and it decided that from SILENCE.

The person record at the time:

    state          home        (committed 13:17:16 from a real GPS ping)
    last_gps_at    13:17:47
    last_lat/lon   12.9 m from the home centre   <-- INSIDE the 80 m zone
    lan_last_seen  11:38        <-- pin dead, phone had moved to cellular

With the LAN pin dead, `effective_state` uses its GPS-only branch and decays
home -> unknown after `stale_home_no_lan_minutes` (30). 13:17:47 + 30 min =
13:47:47. `sweep_expiry` then converts that decay into a COMMITTED not_home:

    13:51:00  src=expiry  reason=ping_expired  home -> not_home

Leave Home fired at 13:49:27, inside that window, and `presence all_away` passed.

The last thing the hub actually knew was **"he is in his living room."** Silence
after that is absence of evidence, not evidence of departure. `lan_presence`
already reasons correctly here — `gps_recent_home()` vetoes a LAN-grace
not_home when the last fix is inside the zone — but `sweep_expiry` never
consulted position at all, only the AGE of the ping.

The asymmetry that matters: letting the DISPLAY go "unknown" costs a stale chip.
Manufacturing a DEPARTURE runs Leave Home — lights off, AC off, on someone who
is home. So `effective_state` may still decay (that is honest: we don't know),
but `sweep_expiry` must not invent a leave event while the last known position
is inside the home zone and still within a trust window.

The window is bounded, not infinite: a phone that suspends GPS *in the driveway*
on the way out would otherwise pin the person home forever and kill leave
detection — the failure this decay was written to catch (iOS Safari suspending
watchPosition).
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import presence_engine as pe


HOME_LAT, HOME_LON = 32.519459, 34.939181   # Canary's real home zone centre
NOW = datetime(2026, 8, 14, 13, 51, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _home_zone(monkeypatch):
    monkeypatch.setattr(pe, "_home_zone", lambda: (HOME_LAT, HOME_LON, 80.0))


def _person(*, last_seen, lat, lon, gps_at, lan_last_seen=None, state="home"):
    return {
        "id": "p1", "name": "Silentyouval", "state": state,
        "last_seen":     last_seen.isoformat(),
        "last_gps_at":   gps_at.isoformat() if gps_at else None,
        "last_lat":      lat, "last_lon": lon,
        "lan_last_seen": lan_last_seen.isoformat() if lan_last_seen else None,
        "history":       [],
    }


# The exact Canary record at 13:51:00.
def _canary_person():
    return _person(
        last_seen     = datetime(2026, 8, 14, 13, 17, 47, tzinfo=timezone.utc),
        gps_at        = datetime(2026, 8, 14, 13, 17, 47, tzinfo=timezone.utc),
        lat=32.5193634, lon=34.9391036,          # 12.9 m out — inside the zone
        lan_last_seen = datetime(2026, 8, 14, 11, 38, 0, tzinfo=timezone.utc),
    )


class TestLastFixInsideHomeBlocksManufacturedDeparture:

    def test_the_canary_record_does_not_produce_a_departure(self, monkeypatch):
        people = [_canary_person()]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        decisions = pe.sweep_expiry(now=NOW)

        committed = [d for d in decisions if d.result == "committed"]
        assert not committed, (
            "silence from a phone whose last fix was 12.9 m from home is not a "
            f"departure — got {[(d.result, d.reason) for d in decisions]}"
        )
        assert people[0]["state"] == "home"

    def test_it_is_recorded_as_a_held_decision_not_silently_dropped(self, monkeypatch):
        """The operator has to be able to see WHY no leave event fired."""
        people = [_canary_person()]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        decisions = pe.sweep_expiry(now=NOW)

        assert decisions, "the hold must leave a trace in the decision history"
        assert any("home" in (d.reason or "") for d in decisions), \
            f"expected a position-based reason, got {[d.reason for d in decisions]}"

    def test_last_fix_OUTSIDE_the_zone_still_expires(self, monkeypatch):
        """The real departure case the 30-min decay exists for. Must still work."""
        people = [_person(
            last_seen = NOW - timedelta(minutes=45),
            gps_at    = NOW - timedelta(minutes=45),
            lat=32.5400, lon=34.9600,            # ~3 km away
        )]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        decisions = pe.sweep_expiry(now=NOW)

        assert any(d.result == "committed" and d.reason == "ping_expired"
                   for d in decisions), \
            f"a stale fix OUTSIDE home is a departure, got {[(d.result, d.reason) for d in decisions]}"
        assert people[0]["state"] == "not_home"

    def test_no_position_at_all_still_expires(self, monkeypatch):
        """Nothing to vouch for — fall back to the old behaviour."""
        people = [_person(
            last_seen = NOW - timedelta(minutes=45),
            gps_at    = None, lat=None, lon=None,
        )]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        decisions = pe.sweep_expiry(now=NOW)
        assert any(d.result == "committed" for d in decisions)

    def test_the_hold_is_bounded_so_leave_detection_cannot_die_forever(self, monkeypatch):
        """A phone that suspended GPS in the driveway must not pin you home for good.

        Past the trust window we can no longer vouch for the position, so the
        departure goes through — same escape hatch lan_presence's veto uses.
        """
        beyond = float(pe._cfg("stale_home_at_home_grace_minutes")) + 60
        people = [_person(
            last_seen = NOW - timedelta(minutes=beyond),
            gps_at    = NOW - timedelta(minutes=beyond),
            lat=32.5193634, lon=34.9391036,      # still "at home", just ancient
        )]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        decisions = pe.sweep_expiry(now=NOW)
        assert any(d.result == "committed" and d.reason == "ping_expired"
                   for d in decisions), "the hold must expire eventually"


class TestDisplayStateIsUnaffected:
    """We still don't KNOW where they are — the chip may say so. Only the
    destructive leave EVENT is held back."""

    def test_effective_state_still_decays_to_unknown(self):
        person = _canary_person()
        assert pe.effective_state(person, now=NOW) == "unknown"


class TestHoldIsRecordedOncePerEpisode:
    """The sweep runs every minute and the hold can last hours.

    `history_size` is 20. Appending a "held" row on every tick would evict the
    real transitions — the ones that made the 2026-08-14 incident readable.
    """

    def test_a_long_hold_leaves_one_marker_not_hundreds(self, monkeypatch):
        people = [_canary_person()]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        for minute in range(30):
            pe.sweep_expiry(now=NOW + timedelta(minutes=minute))

        held = [h for h in people[0]["history"] if h.get("result") == "held"]
        assert len(held) == 1, f"expected a single hold marker, got {len(held)}"

    def test_a_new_episode_is_recorded_again(self, monkeypatch):
        """After a real transition lands, the next hold must be visible."""
        people = [_canary_person()]
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)

        pe.sweep_expiry(now=NOW)
        people[0]["history"].append({"result": "committed", "reason": "arrived"})
        pe.sweep_expiry(now=NOW + timedelta(minutes=1))

        held = [h for h in people[0]["history"] if h.get("result") == "held"]
        assert len(held) == 2
