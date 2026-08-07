"""LAN-host self-heal — a pinned IP must not outlive the phone's DHCP lease.

Live failure (Canary, 2026-08-07): the person's `lan_host` was pinned to
10.100.102.6. DHCP moved the phone, nothing answered .6 again, `lan_last_seen`
froze at 17:31Z while the prober kept firing every minute. With LAN
confirmation dead, effective_state falls to its GPS-only branch (home decays to
unknown after ~30 min), sweep_expiry commits not_home with reason=ping_expired,
and the next position ping flips back to home — an "arrived home" push every
half hour while the user sat at home all day.

The phone tells us where it is every time it talks to Ziggy from the home LAN
(real client IPs survive the docker bridge — verified: a LAN client shows up as
10.100.102.x in the container, only host-local traffic appears as the gateway).
So a home-LAN source IP is ground truth and outranks a pin nothing answers.
"""
from datetime import timedelta

import pytest

from services import presence_engine as pe


@pytest.fixture
def person(tmp_path, monkeypatch):
    """One person backed by a temp persons file — never the real one."""
    monkeypatch.setattr(pe, "PERSONS_FILE", tmp_path / "persons.json", raising=False)
    store = [{
        "id": "p1", "name": "Tester", "state": "home",
        "lan_host": "10.100.102.6",
        "lan_last_seen": pe._now().isoformat(),
        "history": [],
    }]
    monkeypatch.setattr(pe, "_load", lambda: store)
    monkeypatch.setattr(pe, "_save", lambda persons: None)
    return store[0]


def _age_pin(person, minutes):
    person["lan_last_seen"] = (pe._now() - timedelta(minutes=minutes)).isoformat()


# ── The heal itself ──────────────────────────────────────────────────────────

def test_heals_a_dead_pin_to_the_ip_the_phone_is_talking_from(person):
    _age_pin(person, 120)                       # .6 has answered nothing for 2 h
    got = pe.heal_lan_host("p1", "10.100.102.42")
    assert got == "10.100.102.42"
    assert person["lan_host"] == "10.100.102.42"


def test_heal_marks_the_phone_seen_so_the_false_departure_stops_immediately(person):
    """Leaving lan_last_seen stale would keep effective_state on its GPS-only
    branch and fire one more bogus ping_expired before the prober catches up."""
    _age_pin(person, 120)
    pe.heal_lan_host("p1", "10.100.102.42")
    seen = pe._parse_iso(person["lan_last_seen"])
    assert (pe._now() - seen) < timedelta(seconds=30)


def test_healed_person_is_no_longer_stale_to_effective_state(person):
    """End-to-end on the actual decay path: a person whose pin died reads
    'unknown' (which is what sweep_expiry turns into a departure); after the
    heal they read 'home' again."""
    _age_pin(person, 120)
    person["last_seen"] = (pe._now() - timedelta(minutes=90)).isoformat()
    assert pe.effective_state(person) == "unknown"
    pe.heal_lan_host("p1", "10.100.102.42")
    assert pe.effective_state(person) == "home"


# ── Guard rails: never fight a working pin, never trust a non-LAN address ────

def test_healthy_pin_is_never_overwritten(person):
    """The pin is answering — a second address (VPN, tunnel, another interface)
    must not yank presence away from a source that demonstrably works."""
    got = pe.heal_lan_host("p1", "10.100.102.42")
    assert got is None
    assert person["lan_host"] == "10.100.102.6"
    assert person["lan_host_suggested"] == "10.100.102.42"   # offered, not applied


def test_same_ip_is_a_no_op(person):
    _age_pin(person, 120)
    assert pe.heal_lan_host("p1", "10.100.102.6") is None
    assert person["lan_host"] == "10.100.102.6"


@pytest.mark.parametrize("ip", [
    "127.0.0.1",        # request came through a tunnel/proxy on the hub
    "172.18.0.1",       # docker bridge gateway = host-local traffic, not the LAN
    "100.64.1.9",       # CGNAT — carrier, i.e. the phone is on cellular
    "8.8.8.8",          # public
    "", None,
])
def test_non_home_lan_addresses_never_heal(person, ip):
    """A phone on cellular reaching us via the relay must never be mistaken for
    a phone on home Wi-Fi — that would pin presence to a meaningless address."""
    _age_pin(person, 120)
    assert pe.heal_lan_host("p1", ip) is None
    assert person["lan_host"] == "10.100.102.6"


def test_unset_pin_is_only_suggested_never_auto_enabled(person):
    """Matches existing behaviour: with no lan_host configured we record a
    candidate for the Settings screen but never switch LAN probing on."""
    person["lan_host"] = ""
    assert pe.heal_lan_host("p1", "10.100.102.42") is None
    assert person["lan_host"] == ""
    assert person["lan_host_suggested"] == "10.100.102.42"


def test_unknown_person_is_a_no_op(person):
    _age_pin(person, 120)
    assert pe.heal_lan_host("nope", "10.100.102.42") is None
    assert person["lan_host"] == "10.100.102.6"
