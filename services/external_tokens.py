"""Bearer tokens for external agents (Claude Code, Cursor, mcp-remote …).

A person mints a named token in Settings → External assistants; the external
agent presents it as `Authorization: Bearer zgy_…` on `/mcp` and every call
runs as `person:<username>` — the permission ladder, rehearsal and
entitlements all apply exactly as they do for that person in the app.

Storage: table `external_tokens` in the SAME SQLite file as
`services/auth_db.py` (user_files/auth.db). Only the sha256 hex of the token
is stored; the raw token is returned exactly once from `mint()` and is never
logged. Lookup is by hash, so no constant-time compare is needed (there is no
stored secret to compare against — the hash either matches a row or it
doesn't).

    external_tokens
      id            INTEGER PRIMARY KEY
      user_id       INTEGER   (nullable — legacy yaml users have no row id)
      username      TEXT
      name          TEXT      (human label: "Claude Code on the laptop")
      token_hash    TEXT UNIQUE
      created_at    TEXT
      last_used_at  TEXT
      revoked_at    TEXT      (NULL while live)
"""
from __future__ import annotations

import hashlib
import secrets
import threading
from datetime import datetime, timezone
from typing import Optional

from services import auth_db

TOKEN_PREFIX = "zgy_"
_TOKEN_RANDOM_BYTES = 30          # token_urlsafe(30) → exactly 40 url-safe chars

_SCHEMA = """
CREATE TABLE IF NOT EXISTS external_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,
    username     TEXT NOT NULL,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_external_tokens_user ON external_tokens(username);
"""

_init_lock = threading.Lock()
# Memoised per DB path (not a bare bool) so a test that re-points
# `auth_db._DB_PATH` at a fresh temp file gets the table created there too.
_initialized_for: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def _connect():
    """Open the shared auth.db, creating our table on first use per path."""
    global _initialized_for
    auth_db.init()
    path = auth_db._DB_PATH
    if _initialized_for != path:
        with _init_lock:
            if _initialized_for != path:
                with auth_db._connect() as db:
                    db.executescript(_SCHEMA)
                    db.commit()
                _initialized_for = path
    return auth_db._connect()


def _row_out(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "last_used_at": row["last_used_at"],
        "revoked": row["revoked_at"] is not None,
    }


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def mint(username: str, name: str) -> dict:
    """Create a token for `username`. Returns {"id", "name", "token"}.

    The raw token is returned here and nowhere else — the DB holds its hash.
    """
    username = (username or "").strip()
    if not username:
        raise ValueError("username required")
    name = (name or "").strip() or "External assistant"
    user = auth_db.get_user_by_username(username)
    user_id = user["id"] if user else None
    token = TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_RANDOM_BYTES)
    with _connect() as db:
        cur = db.execute(
            """INSERT INTO external_tokens (user_id, username, name, token_hash, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, username, name, _hash(token), _now()),
        )
        db.commit()
        return {"id": cur.lastrowid, "name": name, "token": token}


def verify(token: str) -> Optional[dict]:
    """Resolve a presented bearer token. None when unknown or revoked.

    Stamps `last_used_at` on success. Returns {"id", "username", "name"}.
    """
    token = (token or "").strip()
    if not token or not token.startswith(TOKEN_PREFIX):
        return None
    h = _hash(token)
    with _connect() as db:
        row = db.execute(
            "SELECT id, username, name, revoked_at FROM external_tokens WHERE token_hash = ?",
            (h,),
        ).fetchone()
        if not row or row["revoked_at"] is not None:
            return None
        db.execute(
            "UPDATE external_tokens SET last_used_at = ? WHERE id = ?",
            (_now(), row["id"]),
        )
        db.commit()
        return {"id": row["id"], "username": row["username"], "name": row["name"]}


def list_for(username: str) -> list[dict]:
    """Every token (live and revoked) minted by `username`, oldest first."""
    username = (username or "").strip()
    if not username:
        return []
    with _connect() as db:
        rows = db.execute(
            """SELECT id, name, created_at, last_used_at, revoked_at
               FROM external_tokens WHERE username = ? COLLATE NOCASE
               ORDER BY id""",
            (username,),
        ).fetchall()
        return [_row_out(r) for r in rows]


def revoke(username: str, token_id: int) -> bool:
    """Revoke one of `username`'s own tokens. False if not theirs / unknown /
    already revoked."""
    username = (username or "").strip()
    if not username:
        return False
    with _connect() as db:
        cur = db.execute(
            """UPDATE external_tokens SET revoked_at = ?
               WHERE id = ? AND username = ? COLLATE NOCASE AND revoked_at IS NULL""",
            (_now(), int(token_id), username),
        )
        db.commit()
        return cur.rowcount > 0
