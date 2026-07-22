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


def test_overview_returns_people_and_devices(client):
    app, _ = client
    c = _as(app, "admin", "david")
    r = c.get("/api/permissions/overview")
    assert r.status_code == 200
    body = r.json()
    names = {p["name"] for p in body["people"]}
    assert {"emma", "noam"} <= names
    assert any(d["id"] == "front_lock" for d in body["devices"])
    assert "owner" in body["presets"]


def test_overview_is_denied_to_non_admin(client):
    """A kid/guest account must not be able to enumerate the household."""
    app, _ = client
    c = _as(app, "user", "noam")
    assert c.get("/api/permissions/overview").status_code == 403


def test_delegate_requires_holding_the_parent_grant(client):
    """A non-admin cannot delegate a grant they do not hold (no escalation from
    the owner's authority)."""
    app, svc = client
    # Owner (emma) holds a delegatable whole-home grant.
    admin = _as(app, "super_admin", "emma")
    admin.post("/api/permissions/grants", json={
        "id": "emma_all", "principal": "person:emma", "resource": {"node": "space:home"},
        "capability": "*", "delegatable": True, "max_depth": 1})
    child = {"id": "steal", "principal": "person:noam", "resource": {"node": "space:home"},
             "capability": {"scope_tag": "lighting"}}
    # Noam (a plain user) tries to delegate FROM emma's grant → forbidden.
    noam = _as(app, "user", "noam")
    r = noam.post("/api/permissions/delegate",
                  json={"parent_id": "emma_all", "child": child})
    assert r.status_code == 403
    # An admin may delegate on the household's behalf. (_as rebinds the shared
    # app's auth override, so re-establish the admin identity before this call.)
    admin2 = _as(app, "super_admin", "emma")
    r2 = admin2.post("/api/permissions/delegate",
                     json={"parent_id": "emma_all", "child": child})
    assert r2.status_code == 200


def test_delegate_unknown_parent_is_404(client):
    app, _ = client
    c = _as(app, "super_admin", "emma")
    r = c.post("/api/permissions/delegate", json={
        "parent_id": "ghost",
        "child": {"id": "x", "principal": "person:noam",
                  "resource": {"node": "space:home"}, "capability": "*"}})
    assert r.status_code == 404


def test_bind_role_changes_access(client):
    app, svc = client
    c = _as(app, "super_admin", "emma")
    # Noam starts as a kid → cannot unlock. Promote to adult → can (via app).
    before = c.post("/api/permissions/authorize/explain",
                    json={"subject": "person:noam", "action": "lock.unlock",
                          "resource": "device:front_lock",
                          "context": {"session": {"channel": "app", "trust_level": 3},
                                      "subject": {"age": 20}}})
    assert before.json()["allowed"] is False
    r = c.post("/api/permissions/role-bindings",
               json={"binding_id": "ui:noam", "principal": "person:noam",
                     "scope": "space:home", "role": "adult"})
    assert r.status_code == 200
    after = c.post("/api/permissions/authorize/explain",
                   json={"subject": "person:noam", "action": "lock.unlock",
                         "resource": "device:front_lock",
                         "context": {"session": {"channel": "app", "trust_level": 3},
                                     "subject": {"age": 20}}})
    assert after.json()["allowed"] is True


def test_kid_device_allowlist_roundtrip(client):
    """The per-kid toggle: issue a device-level allow grant, kid can now use
    that device; the grants endpoint reflects it; revoke removes access."""
    app, svc = client
    svc.add_device("kr_light", "light", space_id="home")
    c = _as(app, "super_admin", "emma")
    # Kid can't use the light yet (default-deny).
    d0 = c.post("/api/permissions/authorize/explain",
                json={"subject": "person:noam", "action": "light.onoff",
                      "resource": "device:kr_light"})
    assert d0.json()["allowed"] is False
    # Parent enables it via a device-level grant.
    r = c.post("/api/permissions/grants", json={
        "id": "kidallow:noam:kr_light", "principal": "person:noam", "effect": "allow",
        "resource": {"resource": "device:kr_light"},
        "capability": {"any_of": [{"scope_tag": "lighting"}]}})
    assert r.status_code == 200
    # Grants endpoint shows it.
    gr = c.get("/api/permissions/principals/person:noam/grants")
    assert any(g["id"] == "kidallow:noam:kr_light" for g in gr.json()["grants"])
    # Kid can now use it.
    d1 = c.post("/api/permissions/authorize/explain",
                json={"subject": "person:noam", "action": "light.onoff",
                      "resource": "device:kr_light"})
    assert d1.json()["allowed"] is True
    # Revoke → back to denied.
    assert c.delete("/api/permissions/grants/kidallow:noam:kr_light").status_code == 200
    d2 = c.post("/api/permissions/authorize/explain",
                json={"subject": "person:noam", "action": "light.onoff",
                      "resource": "device:kr_light"})
    assert d2.json()["allowed"] is False


def test_principal_grants_requires_admin(client):
    app, _ = client
    assert _as(app, "user", "noam").get(
        "/api/permissions/principals/person:noam/grants").status_code == 403


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
