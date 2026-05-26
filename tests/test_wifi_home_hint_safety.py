"""Regression: `wifi_home_hint` must never be True for a loopback peer.

Real-world bug: user opened the PWA from cellular while away from home;
every ping arrived from the relay tunnel, so `request.client.host` was
`127.0.0.1`. The old `_is_local_ip` returned True for loopback, which
forced `wifi_home_hint=True` and the engine pinned them to "home"
regardless of GPS. They saw the Dashboard chip lying for 2 hours.

This file pins:
  * `_is_private_ip` excludes loopback.
  * `_client_is_on_home_lan` only returns True when an honest LAN address
    is in XFF / X-Real-IP / direct peer — never just because the TCP peer
    happens to be the tunnel's local endpoint.
"""
from __future__ import annotations

from types import SimpleNamespace

from backend.routers.presence_router import (
    _client_is_on_home_lan,
    _is_private_ip,
)


def _req(headers: dict | None = None, peer: str = "127.0.0.1"):
    """Minimal fake Request — only the bits the helper touches."""
    return SimpleNamespace(
        headers = headers or {},
        client  = SimpleNamespace(host=peer),
    )


def test_loopback_peer_not_treated_as_local():
    # No XFF, no X-Real-IP, TCP peer = 127.0.0.1 (relay tunnel endpoint).
    # MUST NOT be treated as on the home LAN.
    assert _client_is_on_home_lan(_req(peer="127.0.0.1")) is False
    assert _client_is_on_home_lan(_req(peer="::1"))       is False


def test_private_xff_treated_as_home_lan():
    # Phone hitting Ziggy from inside the LAN through a local reverse proxy.
    # XFF first entry is the original client (RFC-1918) → on home LAN.
    assert _client_is_on_home_lan(
        _req(headers={"X-Forwarded-For": "192.168.1.42"}, peer="127.0.0.1")
    ) is True


def test_public_xff_not_treated_as_home():
    # Phone on cellular, public IP at the front of the XFF chain.
    # Tunnel endpoint is 127.0.0.1 — we must NOT fall back to that.
    assert _client_is_on_home_lan(
        _req(headers={"X-Forwarded-For": "203.0.113.7"}, peer="127.0.0.1")
    ) is False


def test_xri_fallback_when_no_xff():
    assert _client_is_on_home_lan(_req(headers={"X-Real-IP": "10.0.0.4"})) is True
    assert _client_is_on_home_lan(_req(headers={"X-Real-IP": "8.8.8.8"})) is False


def test_xff_multi_hop_uses_first_entry():
    # Standard XFF semantics: phone IP, then each proxy. Take the first.
    h = {"X-Forwarded-For": "192.168.1.42, 10.0.0.1, 127.0.0.1"}
    assert _client_is_on_home_lan(_req(headers=h)) is True
    h = {"X-Forwarded-For": "203.0.113.7, 10.0.0.1, 127.0.0.1"}
    assert _client_is_on_home_lan(_req(headers=h)) is False


def test_is_private_ip_excludes_loopback():
    assert _is_private_ip("192.168.1.1") is True
    assert _is_private_ip("10.0.0.1")    is True
    assert _is_private_ip("172.16.0.1")  is True
    assert _is_private_ip("127.0.0.1")   is False
    assert _is_private_ip("::1")         is False
    assert _is_private_ip("8.8.8.8")     is False
    assert _is_private_ip("")            is False
    assert _is_private_ip("not-an-ip")   is False


def test_is_private_ip_excludes_cgnat_and_doc_nets():
    """Python's `ip.is_private` is too broad — these ranges look 'private' but
    a phone hitting Ziggy from one of them is NOT on the home LAN:

      * 100.64.0.0/10 — carrier-grade NAT used by T-Mobile / Verizon
      * 169.254.0.0/16 — IPv4 link-local
      * 198.51.100.0/24, 203.0.113.0/24, 192.0.2.0/24 — TEST-NETs
    """
    # T-Mobile / Verizon CGNAT — the real-world false positive that caused
    # the "I was away but the chip said home" bug.
    assert _is_private_ip("100.64.5.10")   is False
    # Link-local (when no DHCP).
    assert _is_private_ip("169.254.1.1")   is False
    # Documentation / test networks.
    assert _is_private_ip("203.0.113.7")   is False
    assert _is_private_ip("198.51.100.10") is False
    assert _is_private_ip("192.0.2.50")    is False
