"""DELETE /api/permissions/principals/{ref} — drop a person who exists only in
the permission model (sample or seeded entries with no login account).

Canary carried "Sample Adult" and "Sample Kid" on its People screen with no
way to remove them from the product.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.routers import permissions_router as pr


class _Svc:
    def __init__(self):
        self.removed = []

    def remove_principal(self, ref, actor=None):
        self.removed.append((ref, actor))
        return 7


@pytest.fixture
def svc(monkeypatch):
    s = _Svc()
    monkeypatch.setattr(pr, "get_service", lambda: s)
    return s


@pytest.mark.asyncio
async def test_removes_an_unlinked_person(svc):
    res = await pr.remove_principal("person:Sample Kid", user={"username": "owner@x", "role": "super_admin"})
    assert res == {"status": "ok", "seq": 7}
    assert svc.removed == [("person:Sample Kid", pr._self_ref({"username": "owner@x", "role": "super_admin"}))]


@pytest.mark.asyncio
async def test_refuses_non_person_refs(svc):
    with pytest.raises(HTTPException) as e:
        await pr.remove_principal("device:light.kitchen", user={"username": "owner@x", "role": "super_admin"})
    assert e.value.status_code == 400
    assert svc.removed == []


@pytest.mark.asyncio
async def test_refuses_self(svc):
    me = {"username": "owner@x", "role": "super_admin"}
    with pytest.raises(HTTPException) as e:
        await pr.remove_principal(pr._self_ref(me), user=me)
    assert e.value.status_code == 400
