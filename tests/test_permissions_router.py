"""HTTP surface tests for the permission router (role-gating + round-trips)."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import permissions_router as pr
from backend.routers.auth_deps import get_current_user
from services.permissions.audit import AuditLog
from services.permissions.runtime import set_service
from services.permissions.service import PermissionService
from services.permissions.store import PolicyStore


@pytest.fixture
def client(tmp_path):
    svc = PermissionService(store=PolicyStore(str(tmp_path / "p.db")),
                            audit=AuditLog(str(tmp_path / "a.db")))
    # Seed a minimal home.
    svc.add_space("home", "home")
    svc.add_device("front_lock", "lock", space_id="home")
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.bind_role("b_owner", "person:emma", "space:home", "owner")
    svc.add_principal("person:noam", attrs={"age": 9})
    svc.bind_role("b_kid", "person:noam", "space:home", "kid")
    set_service(svc)

    app = FastAPI()
    app.include_router(pr.router)
    yield app, svc
    set_service(None)


def _as(app, role, username):
    app.dependency_overrides[get_current_user] = lambda: {"username": username, "role": role}
    return TestClient(app)


def test_self_authorize_allowed(client):
    app, _ = client
    c = _as(app, "super_admin", "emma")
    r = c.post("/api/permissions/authorize",
               json={"action": "lock.unlock", "resource": "device:front_lock",
                     "context": {"session": {"channel": "app", "trust_level": 3}}})
    assert r.status_code == 200
    assert r.json()["allowed"] is True


def test_self_authorize_kid_denied(client):
    app, _ = client
    c = _as(app, "user", "noam")
    r = c.post("/api/permissions/authorize",
               json={"action": "lock.unlock", "resource": "device:front_lock"})
    assert r.status_code == 200
    assert r.json()["allowed"] is False


def test_cannot_authorize_another_subject_without_admin(client):
    app, _ = client
    c = _as(app, "user", "noam")
    r = c.post("/api/permissions/authorize",
               json={"subject": "person:emma", "action": "lock.unlock",
                     "resource": "device:front_lock"})
    assert r.status_code == 403


def test_admin_can_authorize_other_and_explain(client):
    app, _ = client
    c = _as(app, "admin", "david")
    r = c.post("/api/permissions/authorize/explain",
               json={"subject": "person:emma", "action": "lock.unlock",
                     "resource": "device:front_lock",
                     "context": {"session": {"channel": "app", "trust_level": 3}}})
    assert r.status_code == 200
    body = r.json()
    assert body["allowed"] is True
    assert "trace" in body and body["trace"]


def test_grant_crud_requires_super_admin(client):
    app, _ = client
    # a plain user cannot issue a grant
    cu = _as(app, "user", "noam")
    payload = {"id": "g1", "principal": "person:noam", "resource": {"node": "space:home"},
               "capability": {"scope_tag": "lighting"}}
    assert cu.post("/api/permissions/grants", json=payload).status_code == 403
    # super_admin can
    cs = _as(app, "super_admin", "emma")
    assert cs.post("/api/permissions/grants", json=payload).status_code == 200


def test_who_can_query(client):
    app, _ = client
    c = _as(app, "admin", "david")
    r = c.get("/api/permissions/resources/device:front_lock/principals",
              params={"action": "lock.unlock"})
    assert r.status_code == 200
    assert "person:emma" in r.json()["principals"]
    assert "person:noam" not in r.json()["principals"]


def test_audit_endpoint(client):
    app, _ = client
    c = _as(app, "super_admin", "emma")
    # generate a protected decision
    c.post("/api/permissions/authorize",
           json={"action": "lock.unlock", "resource": "device:front_lock",
                 "context": {"session": {"channel": "app", "trust_level": 3}}})
    r = c.get("/api/permissions/audit", params={"resource": "device:front_lock"})
    assert r.status_code == 200
    assert len(r.json()["events"]) >= 1
