"""Fleet protocol-card push is bounded (2026-11-14 audit): one signed hub
could previously write an unbounded body / unbounded card count / non-dict
cards (500) into the pool every other hub pulls from."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from relay.app import database as dbmod
from relay.app.audit import sign
from relay.app.routers import protocol_cards as pcmod


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(tmp_path / "relay.db"))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at)"
            " VALUES ('h1','H','hub','active','sek',?)", (datetime.now(timezone.utc).isoformat(),))
        await conn.commit()
    app = FastAPI()
    app.include_router(pcmod.router)
    return TestClient(app)


def _push(tc, body: dict):
    raw = json.dumps(body).encode()
    return tc.post("/api/protocol-cards?home_id=h1", content=raw,
                   headers={"X-Ziggy-Signature": sign("sek", raw)})


def test_valid_card_stored(client):
    r = _push(client, {"cards": [{"id": "walk_ab_v1", "rx_validated": True}]})
    assert r.status_code == 200 and r.json()["stored"] == 1


def test_too_many_cards_rejected(client):
    cards = [{"id": f"walk_{i}_v1", "rx_validated": True} for i in range(pcmod.MAX_CARDS_PER_PUSH + 1)]
    assert _push(client, {"cards": cards}).status_code == 422


def test_non_dict_and_oversized_cards_skipped(client):
    big = {"id": "walk_big_v1", "rx_validated": True, "pad": "x" * (pcmod.MAX_CARD_BYTES + 1)}
    r = _push(client, {"cards": ["junk", 7, big]})
    assert r.status_code == 200 and r.json()["stored"] == 0


def test_cards_not_a_list_rejected(client):
    assert _push(client, {"cards": {"id": "x"}}).status_code == 422
