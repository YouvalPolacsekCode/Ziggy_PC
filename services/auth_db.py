"""SQLite-backed user + session store.

Replaces the legacy users[] block in config/settings.yaml. The DB lives at
user_files/auth.db (git-ignored). Sync API — auth flows are not perf-
sensitive and the existing call sites are sync.

Schema:
    users
      id            INTEGER PRIMARY KEY
      username      TEXT    UNIQUE COLLATE NOCASE
      role          TEXT
      password_hash TEXT
      salt          TEXT
      hash_algo     TEXT    DEFAULT 'hmac_sha256'   -- future bcrypt switch
      created_at    TEXT
    sessions
      token         TEXT    PRIMARY KEY
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE
      created_at    TEXT
"""

from __future__ import annotations

import hmac
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "user_files",
    "auth.db",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role          TEXT NOT NULL DEFAULT 'user',
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL DEFAULT '',
    hash_algo     TEXT NOT NULL DEFAULT 'hmac_sha256',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
"""

_init_lock = threading.Lock()
_initialized = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init() -> None:
    """Create tables if they don't exist. Safe to call repeatedly."""
    global _initialized
    with _init_lock:
        if _initialized:
            return
        with _connect() as db:
            db.executescript(_SCHEMA)
            db.commit()
        _initialized = True


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def get_user_by_username(username: str) -> Optional[dict]:
    if not username:
        return None
    init()
    with _connect() as db:
        row = db.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
            (username.strip(),),
        ).fetchone()
        return dict(row) if row else None


def get_user_by_session_token(token: str) -> Optional[dict]:
    if not token:
        return None
    init()
    with _connect() as db:
        row = db.execute(
            """SELECT u.* FROM users u
               JOIN sessions s ON s.user_id = u.id
               WHERE s.token = ?""",
            (token,),
        ).fetchone()
        if not row:
            return None
        user = dict(row)
        tokens = db.execute(
            "SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at",
            (user["id"],),
        ).fetchall()
        user["session_tokens"] = [t["token"] for t in tokens]
        return user


def list_users() -> list[dict]:
    init()
    with _connect() as db:
        rows = db.execute(
            "SELECT id, username, role, hash_algo, created_at FROM users ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


def has_any_user() -> bool:
    init()
    with _connect() as db:
        row = db.execute("SELECT 1 FROM users LIMIT 1").fetchone()
        return row is not None


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------

def create_user(
    username: str,
    password_hash: str,
    salt: str,
    role: str = "user",
    hash_algo: str = "hmac_sha256",
) -> int:
    init()
    with _connect() as db:
        cur = db.execute(
            """INSERT INTO users (username, role, password_hash, salt, hash_algo, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (username.strip(), role, password_hash, salt, hash_algo, _now()),
        )
        db.commit()
        return cur.lastrowid


def update_user_password(
    username: str,
    password_hash: str,
    salt: str,
    hash_algo: str = "hmac_sha256",
) -> bool:
    init()
    with _connect() as db:
        cur = db.execute(
            """UPDATE users
               SET password_hash = ?, salt = ?, hash_algo = ?
               WHERE username = ? COLLATE NOCASE""",
            (password_hash, salt, hash_algo, username.strip()),
        )
        db.commit()
        return cur.rowcount > 0


def update_user_role(username: str, role: str) -> bool:
    init()
    with _connect() as db:
        cur = db.execute(
            "UPDATE users SET role = ? WHERE username = ? COLLATE NOCASE",
            (role, username.strip()),
        )
        db.commit()
        return cur.rowcount > 0


def delete_user(username: str) -> bool:
    init()
    with _connect() as db:
        cur = db.execute(
            "DELETE FROM users WHERE username = ? COLLATE NOCASE",
            (username.strip(),),
        )
        db.commit()
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

_SESSION_CAP = 20  # mirror the legacy YAML cap so per-user list stays bounded


def add_session(user_id: int, token: str) -> None:
    init()
    now = _now()
    with _connect() as db:
        db.execute(
            "INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, now),
        )
        # Trim oldest beyond the cap.
        excess = db.execute(
            """SELECT token FROM sessions
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT -1 OFFSET ?""",
            (user_id, _SESSION_CAP),
        ).fetchall()
        for row in excess:
            db.execute("DELETE FROM sessions WHERE token = ?", (row["token"],))
        db.commit()


def remove_session(token: str) -> None:
    if not token:
        return
    init()
    with _connect() as db:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()


def clear_user_sessions(user_id: int) -> None:
    init()
    with _connect() as db:
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        db.commit()


def compare_session_token(stored: str, presented: str) -> bool:
    # Constant-time compare. Useful when the caller needs to verify a token
    # they already pulled from the DB (rare; usually get_user_by_session_token
    # is enough).
    if not stored or not presented:
        return False
    return hmac.compare_digest(stored, presented)


# ---------------------------------------------------------------------------
# One-time migration from settings.yaml users[]
# ---------------------------------------------------------------------------

def migrate_from_yaml(yaml_users: list[dict]) -> dict:
    """Copy users[] from settings.yaml into auth.db.

    Idempotent — a user already present in the DB (by username, NOCASE) is
    skipped. Returns counts: {migrated_users, migrated_sessions, skipped_users}.

    Designed to be called on every boot. The first boot of the patched agent
    does the actual copy; subsequent boots are a few cheap SELECTs.
    """
    init()
    out = {"migrated_users": 0, "migrated_sessions": 0, "skipped_users": 0}
    if not yaml_users:
        return out
    with _connect() as db:
        for u in yaml_users:
            username = (u.get("username") or "").strip()
            if not username:
                out["skipped_users"] += 1
                continue
            existing = db.execute(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                (username,),
            ).fetchone()
            if existing:
                out["skipped_users"] += 1
                continue
            password_hash = u.get("password_hash") or ""
            if not password_hash:
                # No hash → nothing meaningful to migrate. Skip.
                out["skipped_users"] += 1
                continue
            salt = u.get("salt") or ""
            role = u.get("role") or "user"
            cur = db.execute(
                """INSERT INTO users
                   (username, role, password_hash, salt, hash_algo, created_at)
                   VALUES (?, ?, ?, ?, 'hmac_sha256', ?)""",
                (username, role, password_hash, salt, _now()),
            )
            user_id = cur.lastrowid
            out["migrated_users"] += 1

            # Carry over every active session token so logged-in devices stay
            # logged in across the upgrade.
            tokens: list[str] = list(u.get("session_tokens") or [])
            single = u.get("session_token") or ""
            if single and single not in tokens:
                tokens.append(single)
            for tok in tokens:
                if not tok:
                    continue
                try:
                    db.execute(
                        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
                        (tok, user_id, _now()),
                    )
                    out["migrated_sessions"] += 1
                except sqlite3.IntegrityError:
                    # Token already exists (e.g. shared between yaml entries).
                    pass
        db.commit()
    return out
