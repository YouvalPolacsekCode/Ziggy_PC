"""The LAN departure path, the probe pass, and the durable journal.

Companion to tests/test_presence_expiry_last_fix_at_home.py, which covers the
`sweep_expiry` half. Both departure paths must reach the same verdict, or a
home is at the mercy of whichever one happens to run first.

The 2026-08-14 shape, for reference:
  * `lan_grace` vetoed on a fix up to 12 HOURS old, so the real 07:15 departure
    never fired Leave Home — the last fix before you walk out is your living room.
  * `probe_away_devices` skipped anyone marked home (`state == "home"` →
    `continue`), which is exactly when presence most needs to ask: a dozing
    phone and a departed phone are the same silence.
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import presence_engine as pe


HOME_LAT, HOME_LON = 32.519459, 34.939181
NOW = datetime(2026, 8, 14, 13, 51, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(pe, "_home_zone", lambda: (HOME_LAT, HOME_LON, 80.0))
    from services import presence_journal
    monkeypatch.setattr(presence_journal, "_PATH", tmp_path / "presence_events.jsonl")


# ── LAN grace: freshness, then probe ────────────────────────────────────────

class TestLanGraceVetoNeedsAFreshFix:

    def test_a_twelve_hour_old_fix_no_longer_vetoes(self):
        """The exact regression that stopped Leave Home ever firing."""
        person = {
            "last_lat": 32.5193634, "last_lon": 34.9391036,
            "last_gps_at": (NOW - timedelta(hours=2)).isoformat(),
        }
        # Old behaviour: gps_recent_home(person, 720) → True → departure vetoed.
        assert pe.gps_recent_home(person, 720.0, now=NOW) is True
        # New behaviour: the veto is asked with the FRESHNESS bound instead.
        assert pe.gps_recent_home(person, float(pe._cfg("gps_fresh_minutes")),
                                  now=NOW) is False

    def test_a_genuinely_fresh_fix_still_vetoes(self):
        person = {
            "last_lat": 32.5193634, "last_lon": 34.9391036,
            "last_gps_at": (NOW - timedelta(minutes=3)).isoformat(),
        }
        assert pe.gps_recent_home(person, float(pe._cfg("gps_fresh_minutes")),
                                  now=NOW) is True

    def test_gps_fresh_minutes_is_minutes_not_hours(self):
        """A guard on the value itself — this is the whole bug in one number."""
        assert 1 <= float(pe._cfg("gps_fresh_minutes")) <= 30


class TestLanGraceProbesBeforeDeparting:
    """`probe_all_persons` is async and does real I/O, so drive the decision
    helpers it now depends on rather than the socket layer."""

    def _silent(self, **extra):
        p = {
            "id": "p1", "name": "Silentyouval", "state": "home",
            "last_lat": 32.5193634, "last_lon": 34.9391036,
            "last_gps_at": (NOW - timedelta(hours=2)).isoformat(),
            "lan_last_seen": (NOW - timedelta(minutes=30)).isoformat(),
        }
        p.update(extra)
        return p

    def test_first_round_opens_a_probe_rather_than_departing(self):
        p = self._silent()
        assert pe._departure_probe_waited(p, NOW) is None
        pe.request_departure_probe(p, now=NOW)
        assert p["departure_probe_pending"] is True
        assert pe._departure_probe_waited(p, NOW) == 0.0

    def test_the_grace_is_a_real_wait_not_instant(self):
        grace = float(pe._cfg("departure_probe_grace_seconds"))
        assert grace >= 60, "a probe needs time to wake a dozing phone"
        p = self._silent(departure_probe_at=(NOW - timedelta(seconds=30)).isoformat())
        assert pe._departure_probe_waited(p, NOW) < grace

    def test_past_the_grace_the_departure_is_allowed(self):
        grace = float(pe._cfg("departure_probe_grace_seconds"))
        p = self._silent(
            departure_probe_at=(NOW - timedelta(seconds=grace + 60)).isoformat())
        assert pe._departure_probe_waited(p, NOW) > grace


# ── Probe pass: who gets woken ──────────────────────────────────────────────

class TestProbeSelection:

    def _pe_stub(self, **person):
        base = {"name": "Silentyouval", "state": "home"}
        base.update(person)
        return base

    def test_home_with_a_live_lan_signal_is_not_probed(self):
        from services import mobile_push
        p = self._pe_stub(lan_last_seen=(datetime.now(timezone.utc)
                                         - timedelta(seconds=30)).isoformat())
        assert mobile_push._home_needs_confirming(p, pe) is False

    def test_home_with_a_fresh_fix_is_not_probed(self):
        from services import mobile_push
        p = self._pe_stub(
            last_lat=32.5193634, last_lon=34.9391036,
            last_gps_at=(datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat())
        assert mobile_push._home_needs_confirming(p, pe) is False

    def test_home_on_INERTIA_alone_IS_probed(self):
        """No live LAN, no fresh fix — "home" is an assumption. Ask."""
        from services import mobile_push
        p = self._pe_stub(
            lan_last_seen=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
            last_lat=32.5193634, last_lon=34.9391036,
            last_gps_at=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat())
        assert mobile_push._home_needs_confirming(p, pe) is True

    def test_the_old_entrypoint_name_still_resolves(self):
        """Any missed call site must not silently stop probing."""
        from services import mobile_push
        assert mobile_push.probe_away_devices is mobile_push.probe_devices


# ── Durable journal ─────────────────────────────────────────────────────────

class TestJournal:

    def test_it_writes_and_reads_back(self):
        from services import presence_journal
        presence_journal.record("transition", person="X", prev="home", new="not_home")
        rows = presence_journal.read(limit=10)
        assert rows and rows[-1]["kind"] == "transition"
        assert rows[-1]["person"] == "X"
        assert "ts" in rows[-1]

    def test_it_filters_by_kind(self):
        from services import presence_journal
        presence_journal.record("probe_sent", person="X")
        presence_journal.record("transition", person="X")
        assert all(r["kind"] == "probe_sent"
                   for r in presence_journal.read(limit=10, kind="probe_sent"))

    def test_a_write_failure_never_propagates(self, monkeypatch):
        """Journalling must not be able to break presence."""
        from services import presence_journal
        from pathlib import Path
        monkeypatch.setattr(presence_journal, "_PATH", Path("/nonexistent-dir/x/y.jsonl"))
        presence_journal.record("transition", person="X")   # must not raise

    def test_it_lives_under_user_files_so_it_survives_a_rebuild(self):
        """The whole point: /app/logs dies with the container, user_files is
        bind-mounted."""
        from services import presence_journal
        import importlib
        mod = importlib.reload(presence_journal)
        assert mod.path().parent.name == "user_files"


# ── PWA-only homes: nothing to probe ────────────────────────────────────────
#
# David's and Tslil's homes run the PWA, not the native app — so no FCM token,
# no push_provider, and `probe_devices` has nothing to send. Two of the three
# homes in the fleet are in this shape, so "wait for the phone to answer" must
# degrade to a plain timeout rather than a state that never resolves.

class TestHomeWithNoPushCapableDevice:

    def _silent_at_home(self, **extra):
        p = {
            "id": "p1", "name": "PwaOnly", "state": "home", "history": [],
            "last_seen":   (NOW - timedelta(hours=2)).isoformat(),
            "last_gps_at": (NOW - timedelta(hours=2)).isoformat(),
            "last_lat": 32.5193634, "last_lon": 34.9391036,
            "lan_last_seen": (NOW - timedelta(hours=2)).isoformat(),
        }
        p.update(extra)
        return p

    def _sweep(self, monkeypatch, people, now=NOW):
        monkeypatch.setattr(pe, "_load", lambda: people)
        monkeypatch.setattr(pe, "_save", lambda _p: None)
        return pe.sweep_expiry(now=now)

    def test_the_deadline_runs_on_the_REQUEST_not_on_a_delivered_probe(self, monkeypatch):
        """Nothing ever sends the probe. The departure must still happen.

        `_departure_probe_waited` is anchored to `departure_probe_at`, which the
        engine sets itself — so a home with no push device is only slower, never
        stuck. If this ever became "wait for a send receipt", Leave Home would
        stop working entirely on PWA-only homes.
        """
        people = [self._silent_at_home()]
        self._sweep(monkeypatch, people)
        assert people[0]["departure_probe_pending"] is True   # nothing will clear it

        # Simulate the scheduler finding no FCM device: pending stays True.
        people[0]["departure_probe_at"] = (
            NOW - timedelta(seconds=float(pe._cfg("departure_probe_grace_seconds")) + 60)
        ).isoformat()
        out = self._sweep(monkeypatch, people)

        assert any(d.result == "committed" for d in out), \
            "a home with no push device must still detect a departure"
        assert people[0]["state"] == "not_home"

    def test_a_pwa_foreground_ping_still_settles_it_early(self):
        """The PWA's own GPS ping is a real answer — it clears the deadline."""
        p = self._silent_at_home(departure_probe_at=NOW.isoformat(),
                                 departure_probe_pending=True)
        pe.note_probe_answered(p)
        assert "departure_probe_at" not in p

    def test_probe_pass_is_a_silent_noop_with_no_push_devices(self):
        """No tokens → nothing sent, nothing raised."""
        import asyncio
        from services import mobile_push
        orig = mobile_push._all_devices
        mobile_push._all_devices = lambda: []
        try:
            asyncio.new_event_loop().run_until_complete(mobile_push.probe_devices())
        finally:
            mobile_push._all_devices = orig
