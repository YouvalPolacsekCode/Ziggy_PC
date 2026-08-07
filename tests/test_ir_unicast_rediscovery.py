"""Broadlink rediscovery must not depend on UDP broadcast.

Live failure (Canary, 2026-08-07): the RM4's DHCP lease moved, every IR send
failed, and the existing MAC-anchored self-heal never got a chance because its
first step is `broadlink.discover()` — a UDP *broadcast*. Ziggy runs as a BRIDGE
container, so a broadcast never reaches the LAN: the log just repeated
"No Broadlink answered LAN broadcast" while the device sat there answering
unicast perfectly well.

Unicast routes out of a bridge container fine, so a sweep of the LAN /24 finds
what the broadcast cannot. The MAC-anchored selection that follows is unchanged
— this only fixes how candidates are gathered.
"""
import sys
import types

import pytest

from services import ir_listener as il


class FakeDev:
    def __init__(self, host, mac):
        self.host = (host, 80)
        self.mac = mac


@pytest.fixture
def broadlink(monkeypatch):
    """Stub the broadlink module; hello() answers only at `reachable`."""
    mod = types.SimpleNamespace(
        reachable={},          # ip -> mac
        discover_result=[],
        discover_raises=None,
        hello_calls=[],
    )

    def hello(host, timeout=3):
        mod.hello_calls.append(host)
        if host in mod.reachable:
            return FakeDev(host, mod.reachable[host])
        raise OSError(f"no answer from {host}")

    def discover(timeout=3, **kw):
        if mod.discover_raises:
            raise mod.discover_raises
        return list(mod.discover_result)

    mod.hello, mod.discover = hello, discover
    monkeypatch.setitem(sys.modules, "broadlink", mod)
    # Keep the recovery path off the real filesystem / registry.
    monkeypatch.setattr(il, "_persist_blaster_mac", lambda *a, **k: None)
    monkeypatch.setattr(il, "_persist_blaster_host_change", lambda *a, **k: 1)
    monkeypatch.setattr(il, "_rediscovery_cooldown", {})
    return mod


# ── The sweep itself ─────────────────────────────────────────────────────────

def test_sweep_covers_the_stale_hosts_own_24(broadlink):
    broadlink.reachable = {"10.100.102.27": "aa:bb:cc:dd:ee:ff"}
    found = il._unicast_sweep("10.100.102.6")
    assert [d.host[0] for d in found] == ["10.100.102.27"]
    # Every usable address in the /24 was tried, and the sweep didn't wander
    # outside it.
    assert "10.100.102.1" in broadlink.hello_calls
    assert "10.100.102.254" in broadlink.hello_calls
    assert all(h.startswith("10.100.102.") for h in broadlink.hello_calls)


def test_sweep_skips_network_and_broadcast_addresses(broadlink):
    il._unicast_sweep("10.100.102.6")
    assert "10.100.102.0" not in broadlink.hello_calls
    assert "10.100.102.255" not in broadlink.hello_calls


def test_sweep_on_a_junk_host_is_a_quiet_no_op(broadlink):
    assert il._unicast_sweep("not-an-ip") == []
    assert broadlink.hello_calls == []


# ── Wired into the recovery path ─────────────────────────────────────────────

def test_broadcast_returning_nothing_falls_back_to_unicast(broadlink):
    """The exact Canary failure: broadcast answers nobody, device is at .27."""
    broadlink.discover_result = []
    broadlink.reachable = {"10.100.102.27": "aa:bb:cc:dd:ee:ff"}
    monkey_macs = {"aabbccddeeff"}   # as _norm_mac stores them
    import unittest.mock as m
    with m.patch.object(il, "_lookup_blaster_macs_for_host", lambda h: monkey_macs):
        dev = il._hello_with_rediscovery("10.100.102.6")
    assert dev.host[0] == "10.100.102.27"


def test_broadcast_raising_also_falls_back(broadlink):
    broadlink.discover_raises = OSError("network unreachable")
    broadlink.reachable = {"10.100.102.27": "aa:bb:cc:dd:ee:ff"}
    import unittest.mock as m
    with m.patch.object(il, "_lookup_blaster_macs_for_host", lambda h: set()):
        dev = il._hello_with_rediscovery("10.100.102.6")
    assert dev.host[0] == "10.100.102.27"


def test_mac_anchoring_still_wins_over_a_stranger_blaster(broadlink):
    """Two Broadlinks on the LAN: only the one whose MAC we know may be
    adopted. Guards a multi-blaster home against silently repointing at a
    neighbour's device found by the sweep."""
    broadlink.discover_result = []
    broadlink.reachable = {
        "10.100.102.27": "aa:bb:cc:dd:ee:ff",   # ours
        "10.100.102.40": "11:22:33:44:55:66",   # someone else's
    }
    import unittest.mock as m
    with m.patch.object(il, "_lookup_blaster_macs_for_host", lambda h: {"aabbccddeeff"}):
        dev = il._hello_with_rediscovery("10.100.102.6")
    assert dev.host[0] == "10.100.102.27"


def test_still_raises_when_nothing_answers_anywhere(broadlink):
    broadlink.discover_result = []
    broadlink.reachable = {}
    with pytest.raises(Exception):
        il._hello_with_rediscovery("10.100.102.6")


def test_reachable_host_never_triggers_a_sweep(broadlink):
    """Fast path untouched: no scanning when the cached IP answers."""
    broadlink.reachable = {"10.100.102.6": "aa:bb:cc:dd:ee:ff"}
    dev = il._hello_with_rediscovery("10.100.102.6")
    assert dev.host[0] == "10.100.102.6"
    assert broadlink.hello_calls == ["10.100.102.6"]


# ── Host-change persistence keeps the synthesized entity id consistent ───────

def test_host_change_normalises_a_separately_drifted_entity_id(monkeypatch):
    """`blaster_entity_id` embeds the IP as `direct_<ip>`. It only got rewritten
    when it matched the OLD host exactly, so a record whose entity id had
    drifted in an earlier move was left pointing at a third address (seen live:
    blaster_host=10.100.102.6 while blaster_entity_id=direct_10.100.102.27).
    Harmless for Broadlink sends, which key off blaster_host, but it is a stale
    fact that reads as authoritative. Any record we repoint gets its direct_
    entity id normalised to the new host.
    """
    devices = [
        {"name": "AC",       "blaster_host": "10.100.102.6", "blaster_entity_id": "direct_10.100.102.27"},
        {"name": "TV",       "blaster_host": "10.100.102.6", "blaster_entity_id": "direct_10.100.102.6"},
        {"name": "Untouched","blaster_host": "10.100.102.9", "blaster_entity_id": "direct_10.100.102.9"},
        {"name": "ViaHA",    "blaster_host": "10.100.102.6", "blaster_entity_id": "remote.living_room"},
    ]
    saved = {}
    monkeypatch.setattr("services.ir_manager._load", lambda: devices)
    monkeypatch.setattr("services.ir_manager._save", lambda d: saved.update({"d": d}))

    changed = il._persist_blaster_host_change("10.100.102.6", "10.100.102.24")
    assert changed == 3

    by = {d["name"]: d for d in devices}
    assert by["AC"]["blaster_entity_id"] == "direct_10.100.102.24"   # drifted → normalised
    assert by["TV"]["blaster_entity_id"] == "direct_10.100.102.24"
    # A different blaster is left completely alone.
    assert by["Untouched"]["blaster_host"] == "10.100.102.9"
    assert by["Untouched"]["blaster_entity_id"] == "direct_10.100.102.9"
    # A real HA entity id is NOT an IP handle — never rewritten.
    assert by["ViaHA"]["blaster_entity_id"] == "remote.living_room"
