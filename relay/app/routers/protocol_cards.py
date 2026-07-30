"""
Fleet protocol-card registry.

Hubs that crack an AC remote via the walk wizard push the resulting
protocol card here; every other hub can pull it, so the second home with
the same remote model gets instant support with zero walks. Cards carry
no home identifiers beyond the submitting home's opaque id (kept
server-side only, for validation counting — never returned).

  POST /api/protocol-cards?home_id=...   HMAC-signed (X-Ziggy-Signature,
       same scheme as telemetry) {"cards": [card, ...]}
  GET  /api/protocol-cards[?fingerprint=walk_ab12cd34]
       -> {"cards": [...]}  (only rx_validated cards are served)
"""
from __future__ import annotations

import json as _json
import time

from fastapi import APIRouter, HTTPException, Request

from ..audit import verify as verify_signature
from ..database import get_db

router = APIRouter()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS protocol_cards (
    id            TEXT PRIMARY KEY,
    fingerprint   TEXT,
    card_json     TEXT NOT NULL,
    submitted_by  TEXT,
    validations   INTEGER DEFAULT 1,
    created_at    REAL,
    updated_at    REAL
)
"""


async def _ensure_schema(db) -> None:
    await db.execute(_SCHEMA)
    await db.commit()


@router.post("/api/protocol-cards")
async def push_cards(request: Request, home_id: str):
    raw = await request.body()
    sig_header = request.headers.get("X-Ziggy-Signature", "")
    async with get_db() as db:
        row = await (await db.execute(
            "SELECT relay_secret FROM homes WHERE id=?", (home_id,)
        )).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="unknown home")
        ok, reason = verify_signature(row["relay_secret"], raw, sig_header)
        if not ok:
            raise HTTPException(status_code=401, detail=reason)

        try:
            cards = (_json.loads(raw) or {}).get("cards") or []
        except Exception:
            raise HTTPException(status_code=422, detail="bad body")

        await _ensure_schema(db)
        now = time.time()
        stored = 0
        for card in cards:
            cid = card.get("id")
            if not cid or not card.get("rx_validated"):
                continue  # only hardware-validated cards enter the fleet pool
            existing = await (await db.execute(
                "SELECT submitted_by FROM protocol_cards WHERE id=?", (cid,)
            )).fetchone()
            if existing is None:
                await db.execute(
                    "INSERT INTO protocol_cards (id, fingerprint, card_json,"
                    " submitted_by, validations, created_at, updated_at)"
                    " VALUES (?,?,?,?,1,?,?)",
                    (cid, cid.split("_v")[0], _json.dumps(card), home_id,
                     now, now))
                stored += 1
            elif existing["submitted_by"] != home_id:
                # An independent home confirming the same card = validation
                await db.execute(
                    "UPDATE protocol_cards SET validations = validations + 1,"
                    " updated_at=? WHERE id=?", (now, cid))
        await db.commit()
    return {"ok": True, "stored": stored}


@router.get("/api/protocol-cards")
async def list_cards(fingerprint: str | None = None):
    async with get_db() as db:
        await _ensure_schema(db)
        if fingerprint:
            rows = await db.execute_fetchall(
                "SELECT card_json, validations FROM protocol_cards"
                " WHERE fingerprint=? ORDER BY validations DESC LIMIT 20",
                (fingerprint,))
        else:
            rows = await db.execute_fetchall(
                "SELECT card_json, validations FROM protocol_cards"
                " ORDER BY validations DESC LIMIT 200")
    cards = []
    for r in rows:
        try:
            card = _json.loads(r["card_json"])
            card["fleet_validations"] = r["validations"]
            cards.append(card)
        except Exception:
            continue
    return {"cards": cards}
