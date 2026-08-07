"""Self-configuring LAN presence: the phone reports its address, the hub proves it.

`lan_host` was a hand-typed IP, which cannot work for customers: either it is
never configured (so presence lives permanently on the fragile 30-minute
GPS-only decay and fabricates departures every time the phone dozes) or it is
set once and dies silently at the next DHCP lease. Nobody is going to log into
their router.

The phone knows its own LAN address. It reports it; the hub PINGS it before
trusting it, and that probe is the proof — if the hub can reach it, the phone is
on this home's LAN. An address the hub cannot reach (a coffee-shop 192.168.x) is
ignored. No SSID permission, no router access, no user action, and a DHCP change
repairs itself on the next check-in.

Why a verified self-report outranks a merely-reachable pin: DHCP can hand the
old address to a DIFFERENT device, and then the stale pin keeps answering and
the person looks home forever. The phone's own verified report is authoritative.
"""
from datetime import timedelta

import pytest

from services import lan_presence as lp
from services import presence_engine as pe


@pytest.fixture
def person(tmp_path, monkeypatch):
    store = [{
        "id": "p1", "name": "Tester", "state": "home",
        "lan_host": "10.100.102.6",
        "lan_last_seen": pe._now().isoformat(),
        "history": [],
    }]
    monkeypatch.setattr(pe, "_load", lambda: store)
    monkeypatch.setattr(pe, "_save", lambda persons: None)
    return store[0]


@pytest.fixture
def reachable(monkeypatch):
    """Control exactly which addresses the hub can reach."""
    hosts = set()
    monkeypatch.setattr(lp, "_probe_host", lambda h: h in hosts)
    return hosts


# ── The probe is the proof ───────────────────────────────────────────────────

def test_reported_ip_is_adopted_once_the_hub_can_reach_it(person, reachable):
    reachable.add("10.100.102.42")
    assert lp.adopt_reported_lan_ip("p1", "10.100.102.42") == "10.100.102.42"
    assert person["lan_host"] == "10.100.102.42"


def test_unreachable_report_is_ignored(person, reachable):
    """Phone on a coffee-shop LAN reports 192.168.1.55. Private, plausible, and
    NOT this home — the hub cannot reach it, so it is not adopted."""
    assert lp.adopt_reported_lan_ip("p1", "192.168.1.55") is None
    assert person["lan_host"] == "10.100.102.6"


def test_verified_report_outranks_a_still_answering_pin(person, reachable):
    """The stolen-lease case: DHCP gave .6 to some other device, which happily
    answers pings, so the pin looks healthy while tracking the wrong hardware.
    The phone's own verified address must win."""
    reachable.add("10.100.102.6")     # old pin still answers (wrong device)
    reachable.add("10.100.102.42")    # the phone, self-reported
    person["lan_last_seen"] = pe._now().isoformat()   # pin looks perfectly fresh
    assert lp.adopt_reported_lan_ip("p1", "10.100.102.42") == "10.100.102.42"
    assert person["lan_host"] == "10.100.102.42"


def test_adoption_marks_the_phone_seen(person, reachable):
    reachable.add("10.100.102.42")
    person["lan_last_seen"] = (pe._now() - timedelta(hours=3)).isoformat()
    lp.adopt_reported_lan_ip("p1", "10.100.102.42")
    assert (pe._now() - pe._parse_iso(person["lan_last_seen"])) < timedelta(seconds=30)


def test_same_ip_does_not_probe_or_rewrite(person, reachable, monkeypatch):
    calls = []
    monkeypatch.setattr(lp, "_probe_host", lambda h: calls.append(h) or True)
    assert lp.adopt_reported_lan_ip("p1", "10.100.102.6") is None
    assert calls == []          # no pointless probe on every single check-in
    assert person["lan_host"] == "10.100.102.6"


# ── Never trust an address that isn't a real home-LAN address ────────────────

@pytest.mark.parametrize("ip", [
    "172.18.0.1",     # docker bridge gateway — the hub's own network
    "127.0.0.1",      # loopback
    "100.64.1.9",     # CGNAT — phone is on cellular
    "8.8.8.8",        # public
    "not-an-ip", "", None,
])
def test_junk_and_non_lan_reports_never_probe_or_adopt(person, reachable, monkeypatch, ip):
    calls = []
    monkeypatch.setattr(lp, "_probe_host", lambda h: calls.append(h) or True)
    assert lp.adopt_reported_lan_ip("p1", ip) is None
    assert calls == []
    assert person["lan_host"] == "10.100.102.6"


def test_unknown_person_is_a_no_op(person, reachable):
    reachable.add("10.100.102.42")
    assert lp.adopt_reported_lan_ip("nope", "10.100.102.42") is None
    assert person["lan_host"] == "10.100.102.6"


def test_person_with_no_pin_yet_is_configured_automatically(person, reachable):
    """The customer case: nothing was ever typed in. A verified report should
    switch LAN presence ON, which is the entire point — otherwise every customer
    stays on the 30-minute GPS decay forever."""
    person["lan_host"] = ""
    reachable.add("10.100.102.42")
    assert lp.adopt_reported_lan_ip("p1", "10.100.102.42") == "10.100.102.42"
    assert person["lan_host"] == "10.100.102.42"


# ── A manual pin is respected — but not forever after it dies ────────────────
#
# The live failure this whole thread came from: `lan_host` was typed by hand
# once (lan_host_auto=False), DHCP later moved the phone, and the endpoint's
# "never overwrite a manual entry" rule meant the app's correct self-reports
# were discarded on EVERY check-in. The pin stayed dead indefinitely while
# presence fabricated a departure every ~30 minutes.
#
# Respecting explicit config is right; honouring an address nothing answers,
# while the phone is demonstrably reachable somewhere else, is not. The tie is
# broken by evidence, not by preference: supersede only when the hub CANNOT
# reach the manual pin AND CAN reach the reported address.

def _manual(person, host="10.100.102.6"):
    person["lan_host"] = host
    person["lan_host_auto"] = False


def test_manual_pin_wins_while_it_still_answers(person, reachable):
    _manual(person)
    reachable.add("10.100.102.6")      # manual pin is alive
    reachable.add("10.100.102.42")
    assert lp.adopt_reported_lan_ip("p1", "10.100.102.42") is None
    assert person["lan_host"] == "10.100.102.6"


def test_dead_manual_pin_is_superseded_by_a_reachable_report(person, reachable):
    _manual(person)
    reachable.add("10.100.102.42")     # phone answers here; .6 answers nowhere
    assert lp.adopt_reported_lan_ip("p1", "10.100.102.42") == "10.100.102.42"
    assert person["lan_host"] == "10.100.102.42"
    # Hands it back to zero-config so the next DHCP move needs no human either.
    assert person["lan_host_auto"] is True
    assert person.get("lan_host_manual_superseded_at")


def test_dead_manual_pin_survives_an_unreachable_report(person, reachable):
    """Both dead — the phone is off this LAN (it reported a cafe address). We
    know nothing new, so the user's setting stands."""
    _manual(person)
    assert lp.adopt_reported_lan_ip("p1", "192.168.9.9") is None
    assert person["lan_host"] == "10.100.102.6"
    assert person["lan_host_auto"] is False


# ── The endpoint's AUTO path must verify too ─────────────────────────────────
#
# Caught by an end-to-end probe against the live hub: reporting an address this
# hub cannot reach (192.168.77.77) was accepted and written straight to
# lan_host. Only the manual-supersede branch was probing. That means a phone on
# ANY other network — a cafe, a friend's flat, mobile hotspot — would repoint
# the pin at an unreachable address and blind LAN presence until it came home
# and reported again. Same failure mode as the original bug, freshly re-created.

def test_auto_path_rejects_an_unreachable_report(person, reachable):
    """No manual flag anywhere — the ordinary customer path — and the reported
    address is not reachable from this hub. It must NOT be adopted."""
    person["lan_host_auto"] = True
    assert lp.adopt_reported_lan_ip("p1", "192.168.77.77") is None
    assert person["lan_host"] == "10.100.102.6"


def test_auto_path_rejects_unreachable_even_with_no_pin_configured(person, reachable):
    person["lan_host"] = ""
    person["lan_host_auto"] = True
    assert lp.adopt_reported_lan_ip("p1", "192.168.77.77") is None
    assert (person.get("lan_host") or "") == ""
