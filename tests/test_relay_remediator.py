"""Guardrails on the thing that is allowed to touch customer homes unattended.

The remediator's value is that nobody has to be awake. That is also exactly why
its limits matter more than its capabilities: an unattended loop with a bug
becomes a retry storm against a home that is already struggling.
"""

import pytest

from relay.app import fleet_health as fh
from relay.app import remediator


NOW = 1_786_400_000.0


@pytest.fixture(autouse=True)
def _clean_state():
    remediator._state.clear()
    yield
    remediator._state.clear()


def _mass_lost_home(home_id="home-1", name="David's Home"):
    """A home wearing the 2026-08-09 signature: everything falsely 'lost'."""
    return {
        "id": home_id, "name": name, "status": "active",
        "tunnel_url": "https://hub.example.com", "public_hostname": "",
        "relay_secret": "s3cret",
    }, {
        "ha_version": "2026.6.1",
        "health": {
            "ha_reachable": True, "coordinator_state": "loaded",
            "devices": {"total": 23, "offline": 0},
            "registry": {"total": 23, "lost": 23, "connected": 0},
        },
    }


class TestItActsOnTheRightThings:
    @pytest.mark.asyncio
    async def test_repairs_a_falsely_lost_registry(self, monkeypatch):
        home, payload = _mass_lost_home()
        calls = []

        async def fake_load(now):
            v = fh.evaluate(home, payload, _iso(now - 60), now=now)
            v["_home"] = home
            return [v]

        async def fake_call(h, verb):
            calls.append((h["id"], verb))
            return True, "Recovered 23 device(s) from 'lost'."

        monkeypatch.setattr(remediator, "_load_fleet", fake_load)
        monkeypatch.setattr(remediator, "_call_hub", fake_call)
        monkeypatch.setattr(remediator, "log_event", _noop)

        out = await remediator.sweep_once(now=NOW)
        assert calls == [("home-1", "reconcile")]
        assert out["actions"][0]["ok"] is True

    @pytest.mark.asyncio
    async def test_healthy_home_is_left_alone(self, monkeypatch):
        home = {"id": "h", "name": "ok", "status": "active",
                "tunnel_url": "https://x", "public_hostname": "", "relay_secret": "s"}
        payload = {"health": {"ha_reachable": True, "coordinator_state": "loaded",
                              "devices": {"total": 5, "offline": 0},
                              "registry": {"total": 5, "lost": 0, "connected": 5}}}
        calls = []

        async def fake_load(now):
            v = fh.evaluate(home, payload, _iso(now - 60), now=now)
            v["_home"] = home
            return [v]

        monkeypatch.setattr(remediator, "_load_fleet", fake_load)
        monkeypatch.setattr(remediator, "_call_hub",
                            _fail_if_called("must not touch a healthy home"))
        monkeypatch.setattr(remediator, "log_event", _noop)

        out = await remediator.sweep_once(now=NOW)
        assert out["actions"] == []
        assert calls == []

    @pytest.mark.asyncio
    async def test_silent_hub_is_reported_not_poked(self, monkeypatch):
        """A hub that is powered off cannot be repaired over the network. It
        must be surfaced, not retried against."""
        home = {"id": "h", "name": "dark", "status": "active",
                "tunnel_url": "https://x", "public_hostname": "", "relay_secret": "s"}

        async def fake_load(now):
            v = fh.evaluate(home, None, _iso(now - 7200), now=now)
            v["_home"] = home
            return [v]

        monkeypatch.setattr(remediator, "_load_fleet", fake_load)
        monkeypatch.setattr(remediator, "_call_hub",
                            _fail_if_called("a dark hub has no repairable verb"))
        monkeypatch.setattr(remediator, "log_event", _noop)

        out = await remediator.sweep_once(now=NOW)
        assert out["actions"] == []
        assert out["unhealthy"][0]["level"] == fh.LEVEL_DOWN

    @pytest.mark.asyncio
    async def test_suspended_home_is_never_touched(self, monkeypatch):
        home = {"id": "h", "name": "off", "status": "suspended",
                "tunnel_url": "https://x", "public_hostname": "", "relay_secret": "s"}
        _, payload = _mass_lost_home()

        async def fake_load(now):
            v = fh.evaluate(home, payload, _iso(now - 60), now=now)
            v["_home"] = home
            return [v]

        monkeypatch.setattr(remediator, "_load_fleet", fake_load)
        monkeypatch.setattr(remediator, "_call_hub",
                            _fail_if_called("suspended homes are switched off, not broken"))
        monkeypatch.setattr(remediator, "log_event", _noop)

        assert (await remediator.sweep_once(now=NOW))["actions"] == []


class TestGuardrails:
    @pytest.mark.asyncio
    async def test_cooldown_prevents_a_retry_storm(self, monkeypatch):
        home, payload = _mass_lost_home()
        calls = []
        _wire(monkeypatch, home, payload, calls)

        await remediator.sweep_once(now=NOW)
        await remediator.sweep_once(now=NOW + 60)       # 1 min later
        await remediator.sweep_once(now=NOW + 300)      # 5 min later
        assert len(calls) == 1, "repeated sweeps must not re-poke inside the cooldown"

        out = await remediator.sweep_once(now=NOW + remediator.COOLDOWN_S + 1)
        assert len(calls) == 2, "after the cooldown, one more attempt is allowed"
        assert out["actions"][-1]["attempt"] == 2

    @pytest.mark.asyncio
    async def test_gives_up_and_escalates_after_the_attempt_cap(self, monkeypatch):
        """A fault surviving repeated automated repair is a fault automation
        should stop hiding."""
        home, payload = _mass_lost_home()
        calls = []
        _wire(monkeypatch, home, payload, calls)

        t = NOW
        for _ in range(remediator.MAX_ATTEMPTS + 3):
            await remediator.sweep_once(now=t)
            t += remediator.COOLDOWN_S + 1

        assert len(calls) == remediator.MAX_ATTEMPTS
        last = (await remediator.sweep_once(now=t))["actions"][-1]
        assert "human" in last["skipped"]

    @pytest.mark.asyncio
    async def test_recovery_restores_the_repair_budget(self, monkeypatch):
        """Once a home is healthy again, a NEW fault later should get a full
        budget rather than inheriting the old one's exhausted cap."""
        home, payload = _mass_lost_home()
        calls = []
        _wire(monkeypatch, home, payload, calls)
        await remediator.sweep_once(now=NOW)
        assert len(calls) == 1

        healthy = {"health": {"ha_reachable": True, "coordinator_state": "loaded",
                              "devices": {"total": 23, "offline": 0},
                              "registry": {"total": 23, "lost": 0, "connected": 23}}}
        _wire(monkeypatch, home, healthy, calls)
        await remediator.sweep_once(now=NOW + 60)

        _wire(monkeypatch, home, payload, calls)
        await remediator.sweep_once(now=NOW + 120)
        assert len(calls) == 2, "a recovered home should be repairable again immediately"

    @pytest.mark.asyncio
    async def test_a_failing_hub_does_not_kill_the_sweep(self, monkeypatch):
        home, payload = _mass_lost_home()

        async def fake_load(now):
            v = fh.evaluate(home, payload, _iso(now - 60), now=now)
            v["_home"] = home
            return [v]

        async def boom(h, verb):
            return False, "hub unreachable (tunnel down)"

        monkeypatch.setattr(remediator, "_load_fleet", fake_load)
        monkeypatch.setattr(remediator, "_call_hub", boom)
        monkeypatch.setattr(remediator, "log_event", _noop)

        out = await remediator.sweep_once(now=NOW)
        assert out["actions"][0]["ok"] is False
        assert "unreachable" in out["actions"][0]["message"]

    @pytest.mark.asyncio
    async def test_only_safe_verbs_can_ever_be_dispatched(self):
        """Nothing destructive may be reachable from the unattended path."""
        assert set(remediator._VERB_PATHS) == {"reconcile", "recover-ha"}
        for verb in fh._REMEDY.values():
            assert verb in remediator._VERB_PATHS, f"{verb} has no safe hub route"
        ok, msg = await remediator._call_hub({"id": "h", "tunnel_url": "https://x"}, "factory-reset")
        assert ok is False and "unknown verb" in msg


# ── helpers ────────────────────────────────────────────────────────────────

def _iso(epoch: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


async def _noop(*a, **k):
    return None


def _fail_if_called(why):
    async def _f(*a, **k):
        raise AssertionError(why)
    return _f


def _wire(monkeypatch, home, payload, calls):
    async def fake_load(now):
        v = fh.evaluate(home, payload, _iso(now - 60), now=now)
        v["_home"] = home
        return [v]

    async def fake_call(h, verb):
        calls.append((h["id"], verb))
        return True, "done"

    monkeypatch.setattr(remediator, "_load_fleet", fake_load)
    monkeypatch.setattr(remediator, "_call_hub", fake_call)
    monkeypatch.setattr(remediator, "log_event", _noop)
