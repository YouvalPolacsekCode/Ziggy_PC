"""Shared test isolation.

`services.auth_db` resolves its SQLite path at import time to the real
`user_files/auth.db`. Several services now consult `auth_db.has_any_user()` as
an authoritative "does this hub have an owner yet?" signal — notably
`services.first_boot.get_claim_qr` / `is_first_boot`, which must hard-refuse the
no-auth first-boot claim mint once an owner exists.

Without isolation, those code paths would read the developer's real auth.db
(which usually has accounts), making otherwise-hermetic first-boot tests
environment-dependent. This autouse fixture points auth_db at a per-test temp
database so every test starts from a clean, owner-less hub unless it explicitly
creates users. Tests that manage their own auth_db (via their own monkeypatch of
`auth_db._DB_PATH`) simply re-point it after this fixture runs — the later
monkeypatch wins, so this is additive and non-conflicting.
"""
from __future__ import annotations

import pytest

from services import auth_db


@pytest.fixture(autouse=True)
def _isolate_auth_db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "_conftest_auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    yield
    # Reset the memo so a later test's own _DB_PATH monkeypatch re-inits cleanly.
    monkeypatch.setattr(auth_db, "_initialized", False)


@pytest.fixture(autouse=True)
def _hub_container_networks(monkeypatch):
    """Give presence tests the hub container's view of its own networks.

    `presence_engine._container_local_nets()` reads THIS machine's routing table
    (/proc/net/route) to learn which RFC-1918 nets are the container's own docker
    bridges and never the home LAN. In the hub container that includes the
    gateway 172.18.0.0/16. Elsewhere it does not: macOS has no /proc (so the
    docker-pool fallback applies and tests pass), but a Linux CI runner has
    /proc with its own routes and no 172.18 — so 172.18.0.1 read as a home-LAN
    address and the tests went red for a reason no hub can hit. Pin the cache
    to the docker address pool (172.17–31/16), which covers every bridge a hub
    container is attached to.
    """
    import ipaddress
    import sys
    pe = sys.modules.get("services.presence_engine")
    if pe is not None:
        monkeypatch.setattr(pe, "_container_nets_cache", tuple(
            ipaddress.ip_network(c) for c in pe._DOCKER_POOL_FALLBACK))
    yield
