"""Founder SSH support access — relay side.

Covers:
  * provisioner._build_ingress: exact ordered ingress shape (SSH rule +
    HTTP catch-all) and the HTTP-only backward-compatible shape.
  * provision_hub in dry-run ALSO binds the SSH ingress + SSH DNS route +
    Access app — logged, no network, result carries the ssh_hostname.
  * ZIGGY_SSH_INGRESS_ENABLED default OFF + =0 restores the exact pre-existing
    HTTP-only config (no SSH hostname anywhere).
  * FAIL-CLOSED: an empty ZIGGY_SUPPORT_ALLOWED_EMAILS binds NO SSH ingress /
    DNS / Access app (never an ungated SSH proxy).
  * The Cloudflare Access gate is created BEFORE the public SSH DNS route, and
    the allow policy is reconciled (stale policies deleted → allow-list is
    authoritative).
  * support_session open/revoke: returned command shape, ssh_hostname match,
    authz (founder/relay_admin only → non-admin 403), audit rows, the
    customer-notification hook firing, and the honest audit-only revoke
    response (no false `revoked: true`).

No live tunnel or Cloudflare account required — dry-run + a stubbed httpx.
"""

from __future__ import annotations

import importlib.util
import logging
from datetime import datetime, timezone

import pytest

_has_httpx = importlib.util.find_spec("httpx") is not None
_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(
    not (_has_httpx and _has_jwt), reason="httpx / PyJWT not installed"
)

if _has_httpx and _has_jwt:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app import provisioner as provmod
    from relay.app.auth import issue_jwt
    from relay.app.routers import support_session as ssmod


# ---------------------------------------------------------------------------
# Pure ingress-shape unit tests (no network at all)
# ---------------------------------------------------------------------------

def test_build_ingress_with_ssh_prepends_rule_and_keeps_http_catchall():
    ingress = provmod._build_ingress("http://localhost:8001", "ssh-h1.ssh.ziggy-home.com")
    assert ingress == [
        {"hostname": "ssh-h1.ssh.ziggy-home.com", "service": "ssh://localhost:22"},
        {"service": "http://localhost:8001"},
    ]
    # The final rule MUST be the hostname-less catch-all (Cloudflare requirement).
    assert "hostname" not in ingress[-1]


def test_build_ingress_http_only_is_unchanged_backward_compat():
    assert provmod._build_ingress("http://localhost:8001") == [
        {"service": "http://localhost:8001"}
    ]
    assert provmod._build_ingress("http://localhost:8001", "") == [
        {"service": "http://localhost:8001"}
    ]


def test_ssh_hostname_helper_reads_env(monkeypatch):
    monkeypatch.setenv("ZIGGY_SSH_DOMAIN", "ssh.example.dev")
    assert provmod.ssh_hostname_for("abc-9") == "ssh-abc-9.ssh.example.dev"


# ---------------------------------------------------------------------------
# provision_hub dry-run — SSH ingress is bound additively
# ---------------------------------------------------------------------------

@pytest.fixture
def no_network(monkeypatch):
    class _Boom:
        def __init__(self, *a, **k):
            raise AssertionError("dry-run must not open an httpx client")

    monkeypatch.setattr(provmod.httpx, "AsyncClient", _Boom)


async def test_dry_run_binds_ssh_ingress_and_route(monkeypatch, no_network, caplog):
    monkeypatch.setenv("CF_PROVISION_DRY_RUN", "1")
    monkeypatch.setenv("ZIGGY_SSH_INGRESS_ENABLED", "1")
    monkeypatch.setenv("ZIGGY_SSH_DOMAIN", "ssh.test.dev")
    monkeypatch.setenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", "founder@ziggy.app")
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "")

    home_id = "home-ssh-1"
    with caplog.at_level(logging.INFO, logger="ziggy.relay.provisioner"):
        result = await provmod.provision_hub(
            home_id=home_id, home_name="SSH Home", relay_url="https://relay.example",
        )

    assert result.ssh_hostname == f"ssh-{home_id}.ssh.test.dev"

    logtext = "\n".join(r.getMessage() for r in caplog.records)
    # Tunnel ingress carries the ssh:// rule alongside the http catch-all.
    assert "ssh://localhost:22" in logtext
    assert "http://localhost:8001" in logtext
    # SSH hostname got a CNAME and a gated Access app.
    assert f"ssh-{home_id}.ssh.test.dev" in logtext
    assert "Access app upsert" in logtext
    assert "founder@ziggy.app" in logtext


async def test_dry_run_ssh_disabled_is_http_only(monkeypatch, no_network, caplog):
    monkeypatch.setenv("CF_PROVISION_DRY_RUN", "1")
    monkeypatch.setenv("ZIGGY_SSH_INGRESS_ENABLED", "0")
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "")

    with caplog.at_level(logging.INFO, logger="ziggy.relay.provisioner"):
        result = await provmod.provision_hub(
            home_id="home-http", home_name="H", relay_url="https://r",
        )

    assert result.ssh_hostname == ""
    logtext = "\n".join(r.getMessage() for r in caplog.records)
    assert "ssh://localhost:22" not in logtext
    assert "Access app upsert" not in logtext


async def test_dry_run_ssh_fail_closed_when_no_allowed_emails(monkeypatch, no_network, caplog):
    # C1: an empty allow-list must NEVER stand up an ungated SSH proxy. Even with
    # the feature enabled, provision_hub binds no ingress / DNS / Access app.
    monkeypatch.setenv("CF_PROVISION_DRY_RUN", "1")
    monkeypatch.setenv("ZIGGY_SSH_INGRESS_ENABLED", "1")
    monkeypatch.delenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", raising=False)
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "")

    with caplog.at_level(logging.INFO, logger="ziggy.relay.provisioner"):
        await provmod.provision_hub(home_id="hu", home_name="H", relay_url="https://r")
    logtext = "\n".join(r.getMessage() for r in caplog.records)
    # Fail-closed warning is logged and NOTHING SSH-related is bound.
    assert "refusing to bind ssh ingress" in logtext.lower()
    assert "Access app upsert" not in logtext
    assert "ssh://localhost:22" not in logtext


async def test_ssh_ingress_default_off(monkeypatch, no_network, caplog):
    # C1: ZIGGY_SSH_INGRESS_ENABLED defaults OFF — SSH ingress is opt-in per home.
    monkeypatch.setenv("CF_PROVISION_DRY_RUN", "1")
    monkeypatch.delenv("ZIGGY_SSH_INGRESS_ENABLED", raising=False)
    monkeypatch.setenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", "founder@ziggy.app")
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "")

    with caplog.at_level(logging.INFO, logger="ziggy.relay.provisioner"):
        result = await provmod.provision_hub(home_id="hd", home_name="H", relay_url="https://r")

    assert result.ssh_hostname == ""
    logtext = "\n".join(r.getMessage() for r in caplog.records)
    assert "ssh://localhost:22" not in logtext
    assert "Access app upsert" not in logtext


# ---------------------------------------------------------------------------
# Non-dry-run SSH ingress — fail-closed gate + policy reconciliation (mocked CF)
# ---------------------------------------------------------------------------

class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")


class _FakeCFClient:
    """Records the ordered sequence of CF API calls and returns canned results.

    Simulates: no existing Access app (→ POST creates one), two pre-existing
    stale allow policies (→ must be DELETEd), and no existing DNS record.
    """

    def __init__(self, calls, policies_existing):
        self.calls = calls
        self.policies_existing = policies_existing

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, headers=None, params=None):
        self.calls.append(("GET", url))
        if url.endswith("/access/apps"):
            return _FakeResp({"result": []})           # no existing app for domain
        if url.endswith("/policies"):
            return _FakeResp({"result": self.policies_existing})
        if "/dns_records" in url:
            return _FakeResp({"result": []})
        return _FakeResp({"result": []})

    async def post(self, url, headers=None, json=None):
        self.calls.append(("POST", url))
        if url.endswith("/access/apps"):
            return _FakeResp({"result": {"id": "app-1"}})
        return _FakeResp({"result": {"id": "new"}})

    async def put(self, url, headers=None, json=None):
        self.calls.append(("PUT", url))
        return _FakeResp({"result": {"id": "x"}})

    async def delete(self, url, headers=None):
        self.calls.append(("DELETE", url))
        return _FakeResp({"result": {}})


async def test_ssh_ingress_empty_allowlist_touches_no_network(monkeypatch, caplog):
    # C1 fail-closed at the _provision_ssh_ingress level: with no allow-list we
    # must not open a CF client at all — no ingress, no DNS, no Access app.
    monkeypatch.delenv("CF_PROVISION_DRY_RUN", raising=False)
    monkeypatch.delenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", raising=False)
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "tok")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "acct")
    monkeypatch.setattr(provmod, "CF_ZONE_ID", "zone")

    class _Boom:
        def __init__(self, *a, **k):
            raise AssertionError("empty allow-list must not touch Cloudflare")

    monkeypatch.setattr(provmod.httpx, "AsyncClient", _Boom)

    with caplog.at_level(logging.WARNING, logger="ziggy.relay.provisioner"):
        await provmod._provision_ssh_ingress(
            "home-x", "tun-x", "ssh-home-x.ssh.ziggy-home.com"
        )
    logtext = "\n".join(r.getMessage() for r in caplog.records)
    assert "refusing to bind ssh ingress" in logtext.lower()


async def test_ssh_ingress_gate_before_dns_and_reconciles_policies(monkeypatch):
    # C1 (b): the Access gate is created BEFORE the public DNS route.
    # M1: pre-existing (stale) allow policies are deleted so the current
    # allow-list is authoritative.
    monkeypatch.delenv("CF_PROVISION_DRY_RUN", raising=False)
    monkeypatch.setenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", "founder@ziggy.app")
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "tok")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "acct")
    monkeypatch.setattr(provmod, "CF_ZONE_ID", "zone")

    calls: list = []

    def _factory(*a, **k):
        return _FakeCFClient(calls, policies_existing=[{"id": "stale-1"}, {"id": "stale-2"}])

    monkeypatch.setattr(provmod.httpx, "AsyncClient", _factory)

    await provmod._provision_ssh_ingress(
        "home-x", "tun-x", "ssh-home-x.ssh.ziggy-home.com"
    )

    # Gate before route: first access/apps call precedes first dns_records call.
    first_app = next(i for i, (m, u) in enumerate(calls) if "/access/apps" in u)
    first_dns = next(i for i, (m, u) in enumerate(calls) if "/dns_records" in u)
    assert first_app < first_dns, calls

    # Stale policies were deleted (reconciliation → allow-list authoritative).
    pol_deletes = [u for (m, u) in calls if m == "DELETE" and "/policies/" in u]
    assert any("stale-1" in u for u in pol_deletes), calls
    assert any("stale-2" in u for u in pol_deletes), calls
    # A fresh allow policy was POSTed after clearing the stale ones.
    assert any(m == "POST" and u.endswith("/policies") for (m, u) in calls), calls


async def test_access_app_failure_blocks_dns_route(monkeypatch):
    # C1 (b): if the Access gate can't be created, NO public SSH DNS route is
    # published (an ungated route would be reachable SSH).
    monkeypatch.delenv("CF_PROVISION_DRY_RUN", raising=False)
    monkeypatch.setenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", "founder@ziggy.app")
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "tok")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "acct")
    monkeypatch.setattr(provmod, "CF_ZONE_ID", "zone")

    calls: list = []

    class _AppFailsClient(_FakeCFClient):
        async def post(self, url, headers=None, json=None):
            self.calls.append(("POST", url))
            if url.endswith("/access/apps"):
                return _FakeResp({"errors": ["boom"]}, status=500)  # gate creation fails
            return _FakeResp({"result": {"id": "new"}})

    def _factory(*a, **k):
        return _AppFailsClient(calls, policies_existing=[])

    monkeypatch.setattr(provmod.httpx, "AsyncClient", _factory)

    # _provision_ssh_ingress swallows the error (best-effort) but must NOT reach
    # the DNS route step.
    await provmod._provision_ssh_ingress(
        "home-x", "tun-x", "ssh-home-x.ssh.ziggy-home.com"
    )
    assert not any("/dns_records" in u for (m, u) in calls), calls


# ---------------------------------------------------------------------------
# support-session endpoints (open / revoke) via TestClient
# ---------------------------------------------------------------------------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
def client(db, monkeypatch):
    # Deterministic SSH domain + user for command-shape assertions.
    monkeypatch.setenv("ZIGGY_SSH_DOMAIN", "ssh.ziggy-home.com")
    monkeypatch.setattr(ssmod, "SSH_USER", "ziggy-support")
    app = FastAPI()
    app.include_router(ssmod.router)
    return TestClient(app)


async def _seed_home(db, home_id, owner_email="owner@x.com"):
    async with db.get_db() as conn:
        await conn.execute(
            """INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret,
                                  cf_tunnel_id, created_at, owner_email)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (home_id, "Test Home", "hub", f"https://{home_id}.hubs.ziggy-home.com",
             "active", "sekret", "tun-1",
             datetime.now(timezone.utc).isoformat(), owner_email),
        )
        await conn.commit()


def _admin_headers():
    tok = issue_jwt("u-admin", "founder@ziggy.app", "relay_admin", None)
    return {"Authorization": f"Bearer {tok}"}


def _user_headers(home_id):
    tok = issue_jwt("u-1", "cust@x.com", "user", home_id)
    return {"Authorization": f"Bearer {tok}"}


async def test_open_returns_working_command_shape(client, db, monkeypatch):
    await _seed_home(db, "home-a")
    fired: list = []

    async def _capture(home_id, event, detail):
        fired.append((home_id, event, detail))

    monkeypatch.setattr(ssmod, "notify_customer", _capture)

    r = client.post(
        "/api/admin/homes/home-a/support-session",
        json={"reason": "debug z2m dropouts"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ssh_hostname"] == "ssh-home-a.ssh.ziggy-home.com"
    assert body["ssh_snippet"] == (
        "cloudflared access ssh --hostname ssh-home-a.ssh.ziggy-home.com "
        "--user ziggy-support"
    )
    assert body["audit_id"] is not None
    # Customer notification hook fired on open.
    assert fired and fired[0][1] == "support_session_opened"

    # Durable audit row written.
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT event, ok, detail FROM audit_log WHERE home_id='home-a'"
        )
    assert any(dict(x)["event"] == "support_session_opened" and dict(x)["ok"] == 1
               for x in rows)


async def test_open_requires_founder_role(client, db):
    await _seed_home(db, "home-a")
    # A normal customer user (role 'user') must be rejected.
    r = client.post(
        "/api/admin/homes/home-a/support-session",
        json={}, headers=_user_headers("home-a"),
    )
    assert r.status_code == 403


async def test_open_unknown_home_404_and_audits(client, db):
    r = client.post(
        "/api/admin/homes/ghost/support-session",
        json={}, headers=_admin_headers(),
    )
    assert r.status_code == 404
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT ok, detail FROM audit_log WHERE home_id='ghost'"
        )
    assert rows and dict(rows[0])["ok"] == 0
    assert "unknown_home_id" in dict(rows[0])["detail"]


async def test_revoke_writes_audit_and_notifies(client, db, monkeypatch):
    await _seed_home(db, "home-a")
    fired: list = []

    async def _capture(home_id, event, detail):
        fired.append(event)

    monkeypatch.setattr(ssmod, "notify_customer", _capture)

    r = client.post(
        "/api/admin/homes/home-a/support-session/revoke",
        json={"reason": "done"}, headers=_admin_headers(),
    )
    assert r.status_code == 200
    body = r.json()
    # M2: revoke is audit-only on the relay side — it must NOT falsely claim it
    # revoked host access.
    assert "revoked" not in body
    assert body["audit_only"] is True
    assert body["host_revoke_required"] is True
    assert "support_session_revoked" in fired

    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT event FROM audit_log WHERE home_id='home-a' AND event='support_session_revoked'"
        )
    assert rows


async def test_revoke_requires_founder_role(client, db):
    await _seed_home(db, "home-a")
    r = client.post(
        "/api/admin/homes/home-a/support-session/revoke",
        json={}, headers=_user_headers("home-a"),
    )
    assert r.status_code == 403
