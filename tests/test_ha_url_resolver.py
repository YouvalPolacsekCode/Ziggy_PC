"""Unit tests for services.ha_url_resolver — the self-healing HA base URL.

Regression cover for the Canary outage of 2026-08-05: the hub's HA_URL was
pinned to a literal LAN IP (10.100.102.15), a power cut moved the DHCP lease
to 10.100.102.4, and the subscriber retried "No route to host" 558 times over
9h50m while Home Assistant sat healthy on the new address.

These tests are PURE — no sockets, no /proc, no HA. Every environment probe is
injected.
"""
from __future__ import annotations

import pytest

from services import ha_url_resolver as R


# ── is_ip_pinned ────────────────────────────────────────────────────────────

class TestIsIpPinned:
    @pytest.mark.parametrize("url", [
        "http://10.100.102.15:8123",
        "http://192.168.1.171:8123",
        "https://172.18.0.1:8123",
        "http://127.0.0.1:8123",
    ])
    def test_literal_ipv4_is_pinned(self, url):
        assert R.is_ip_pinned(url) is True

    @pytest.mark.parametrize("url", [
        "http://host.docker.internal:8123",
        "http://homeassistant:8123",
        "http://localhost:8123",
        "https://homeassistant.local:8123",
        "",
    ])
    def test_hostnames_are_not_pinned(self, url):
        assert R.is_ip_pinned(url) is False


# ── candidate ordering ──────────────────────────────────────────────────────

class TestCandidateUrls:
    def test_host_docker_internal_is_tried_first(self):
        # It is what imaging writes and the only DHCP-immune name that works
        # from a bridge container against a network_mode:host HA.
        cands = R.candidate_urls("http://10.100.102.15:8123", gateways=[])
        assert cands[0] == "http://host.docker.internal:8123"

    def test_current_url_is_excluded(self):
        # The caller only asks after `current` has already failed.
        current = "http://host.docker.internal:8123"
        assert current not in R.candidate_urls(current, gateways=[])

    def test_gateways_are_included_after_stable_names(self):
        cands = R.candidate_urls("http://10.100.102.15:8123", gateways=["172.18.0.1"])
        assert "http://172.18.0.1:8123" in cands
        assert cands.index("http://host.docker.internal:8123") < cands.index("http://172.18.0.1:8123")

    def test_port_is_preserved_from_current(self):
        cands = R.candidate_urls("http://10.100.102.15:9123", gateways=["172.18.0.1"])
        assert all(c.endswith(":9123") for c in cands), cands

    def test_default_port_when_current_has_none(self):
        cands = R.candidate_urls("http://10.100.102.15", gateways=[])
        assert "http://host.docker.internal:8123" in cands

    def test_no_duplicates(self):
        cands = R.candidate_urls("http://10.0.0.5:8123", gateways=["172.18.0.1", "172.18.0.1"])
        assert len(cands) == len(set(cands))

    def test_empty_current_still_yields_candidates(self):
        # A hub with no configured URL at all should still be healable.
        assert R.candidate_urls("", gateways=[])


# ── /proc/net/route parsing ─────────────────────────────────────────────────

class TestParseProcNetRoute:
    # Destination 00000000 == default route. Gateway is little-endian hex.
    PROC = (
        "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\n"
        "eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\n"
        "eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\n"
    )

    def test_extracts_default_gateway(self):
        assert R.parse_proc_net_route(self.PROC) == ["172.18.0.1"]

    def test_ignores_non_default_routes(self):
        only_local = (
            "Iface\tDestination\tGateway \tFlags\n"
            "eth0\t000012AC\t00000000\t0001\n"
        )
        assert R.parse_proc_net_route(only_local) == []

    def test_garbage_does_not_raise(self):
        assert R.parse_proc_net_route("not a route table at all") == []
        assert R.parse_proc_net_route("") == []


# ── resolve_working_url ─────────────────────────────────────────────────────

class TestShouldAttemptHeal:
    def test_quiet_for_the_first_failures(self):
        # A single dropped WebSocket is not evidence the address moved.
        assert R.should_attempt_heal(0) is False
        assert R.should_attempt_heal(1) is False
        assert R.should_attempt_heal(R.HEAL_AFTER_FAILURES - 1) is False

    def test_fires_at_the_threshold(self):
        assert R.should_attempt_heal(R.HEAL_AFTER_FAILURES) is True

    def test_retries_periodically_not_every_attempt(self):
        n = R.HEAL_AFTER_FAILURES
        fired = [i for i in range(n, n * 10) if R.should_attempt_heal(i)]
        assert fired == list(range(n, n * 10, n))


def _probe_that_accepts(*good_urls):
    """Build a fake probe_ha that only authenticates against `good_urls`."""
    seen = []

    async def probe(url, token, timeout=4.0):
        seen.append(url)
        if url in good_urls:
            return {"ok": True, "ha_version": "2026.6.1"}
        return {"ok": False, "error": "could not reach Home Assistant"}

    probe.seen = seen
    return probe


class TestResolveWorkingUrl:
    async def test_returns_first_candidate_that_authenticates(self):
        probe = _probe_that_accepts("http://host.docker.internal:8123")
        got = await R.resolve_working_url(
            "http://10.100.102.15:8123", "tok", probe=probe, gateways=[]
        )
        assert got == "http://host.docker.internal:8123"

    async def test_falls_through_to_gateway_when_names_fail(self):
        probe = _probe_that_accepts("http://172.18.0.1:8123")
        got = await R.resolve_working_url(
            "http://10.100.102.15:8123", "tok", probe=probe, gateways=["172.18.0.1"]
        )
        assert got == "http://172.18.0.1:8123"

    async def test_returns_none_when_nothing_answers(self):
        probe = _probe_that_accepts()   # accepts nothing
        got = await R.resolve_working_url(
            "http://10.100.102.15:8123", "tok", probe=probe, gateways=["172.18.0.1"]
        )
        assert got is None

    async def test_stops_probing_after_first_success(self):
        probe = _probe_that_accepts("http://host.docker.internal:8123")
        await R.resolve_working_url(
            "http://10.100.102.15:8123", "tok", probe=probe, gateways=["172.18.0.1"]
        )
        assert probe.seen == ["http://host.docker.internal:8123"]

    async def test_no_token_means_no_probing(self):
        # Without a token every probe would fail auth; don't hammer the network.
        probe = _probe_that_accepts("http://host.docker.internal:8123")
        assert await R.resolve_working_url("http://x:8123", "", probe=probe, gateways=[]) is None
        assert probe.seen == []

    async def test_probes_every_candidate_before_giving_up(self):
        probe = _probe_that_accepts()
        await R.resolve_working_url(
            "http://10.100.102.15:8123", "tok", probe=probe, gateways=["172.18.0.1"]
        )
        assert probe.seen == R.candidate_urls(
            "http://10.100.102.15:8123", gateways=["172.18.0.1"]
        )

    async def test_a_raising_probe_does_not_abort_the_search(self):
        async def probe(url, token, timeout=4.0):
            if url == "http://host.docker.internal:8123":
                raise OSError("boom")
            return {"ok": True, "ha_version": "2026.6.1"}

        got = await R.resolve_working_url(
            "http://10.0.0.9:8123", "tok", probe=probe, gateways=[]
        )
        assert got is not None
        assert got != "http://host.docker.internal:8123"
