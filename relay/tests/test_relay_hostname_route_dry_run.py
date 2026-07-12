"""Stream 3 — per-home public hostname routing + dry-run mode.

Covers:
  * provision_hub in dry-run makes NO real HTTP calls and returns the
    reachable_url (per-home public hostname)
  * the intended Cloudflare DNS CNAME call is logged
  * dry-run bypasses the CF-credential requirement
"""

from __future__ import annotations

import importlib.util
import logging

import pytest

_has_httpx = importlib.util.find_spec("httpx") is not None
pytestmark = pytest.mark.skipif(not _has_httpx, reason="httpx not installed")

if _has_httpx:
    from relay.app import provisioner as provmod


@pytest.fixture
def no_network(monkeypatch):
    """Blow up if any real httpx client is opened during a dry run."""
    class _Boom:
        def __init__(self, *a, **k):
            raise AssertionError("dry-run must not open an httpx client")

    monkeypatch.setattr(provmod.httpx, "AsyncClient", _Boom)


async def test_dry_run_returns_reachable_url_and_no_network(monkeypatch, no_network, caplog):
    monkeypatch.setenv("CF_PROVISION_DRY_RUN", "1")
    monkeypatch.setenv("CF_ZONE_ID", "zone-xyz")
    # No CF creds set — dry-run must not require them.
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "")

    home_id = "abc-123"
    with caplog.at_level(logging.INFO, logger="ziggy.relay.provisioner"):
        result = await provmod.provision_hub(
            home_id=home_id, home_name="Dry Home", relay_url="https://relay.example",
        )

    assert result.home_id == home_id
    assert result.reachable_url == f"https://{home_id}.hubs.ziggy-home.com"
    assert result.tunnel_token  # a (fake) token was produced
    assert result.relay_secret

    logtext = "\n".join(r.getMessage() for r in caplog.records)
    assert "[dry-run] DNS upsert CNAME" in logtext
    assert f"{home_id}.hubs.ziggy-home.com" in logtext
    assert "cfargotunnel.com" in logtext


async def test_dry_run_custom_hub_domain(monkeypatch, no_network):
    monkeypatch.setenv("CF_PROVISION_DRY_RUN", "1")
    monkeypatch.setattr(provmod, "CF_HUB_DOMAIN", "hubs.example.dev")
    result = await provmod.provision_hub(
        home_id="h9", home_name="H", relay_url="https://r",
    )
    assert result.reachable_url == "https://h9.hubs.example.dev"


async def test_dns_route_skipped_without_zone_id(monkeypatch, caplog):
    # Not dry-run, but CF_ZONE_ID unset → DNS route is skipped with a warning,
    # never touching the network. Returns the hostname regardless.
    monkeypatch.delenv("CF_PROVISION_DRY_RUN", raising=False)
    monkeypatch.setattr(provmod, "CF_ZONE_ID", "")
    with caplog.at_level(logging.WARNING, logger="ziggy.relay.provisioner"):
        hostname = await provmod._cf_upsert_dns_route("home-z", "tun-z")
    assert hostname == "home-z.hubs.ziggy-home.com"
    assert any("CF_ZONE_ID unset" in r.getMessage() for r in caplog.records)
