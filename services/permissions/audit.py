"""Decision/action audit ledger — append-only attribution for every action.

Separate from the *policy* event log (``store.py``): that one records how policy
*changed*; this one records how policy was *used* — every protected decision,
who made it, over which channel/identity, and (for AI/automation) the delegation
chain that authorized it. Together they answer both "who could do X?" (policy
log, point-in-time) and "who actually did X?" (this log).

Kept deliberately tiny and dependency-free so it can be written from the hot
decision path without dragging the engine into it.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

_DEFAULT_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "user_files",
    "permissions_audit.db",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decision_events (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT NOT NULL,
    subject         TEXT NOT NULL,
    identity        TEXT,
    channel         TEXT,
    actor_kind      TEXT,
    action          TEXT NOT NULL,
    resource        TEXT NOT NULL,
    effect          TEXT NOT NULL,
    obligations     TEXT,
    delegation_chain TEXT,
    reason          TEXT,
    correlation_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_dec_subject ON decision_events(subject);
CREATE INDEX IF NOT EXISTS idx_dec_resource ON decision_events(resource);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuditLog:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or _DEFAULT_DB
        self._lock = threading.Lock()
        with self._connect() as db:
            db.executescript(_SCHEMA)
            db.commit()

    def _connect(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def record(self, *, subject: str, action: str, resource: str, effect: str,
               identity: str | None = None, channel: str | None = None,
               actor_kind: str | None = None, obligations: list | None = None,
               delegation_chain: list | None = None, reason: str = "",
               correlation_id: str | None = None) -> int:
        with self._lock, self._connect() as db:
            cur = db.execute(
                "INSERT INTO decision_events (ts, subject, identity, channel, actor_kind,"
                " action, resource, effect, obligations, delegation_chain, reason,"
                " correlation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (_now(), subject, identity, channel, actor_kind, action, resource,
                 effect, json.dumps(obligations or []),
                 json.dumps(delegation_chain or []), reason, correlation_id),
            )
            db.commit()
            return cur.lastrowid

    def query(self, *, subject: str | None = None, resource: str | None = None,
              limit: int = 100) -> list[dict]:
        clauses, params = [], []
        if subject:
            clauses.append("subject = ?")
            params.append(subject)
        if resource:
            clauses.append("resource = ?")
            params.append(resource)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(limit)
        with self._connect() as db:
            rows = db.execute(
                f"SELECT * FROM decision_events{where} ORDER BY seq DESC LIMIT ?",
                params).fetchall()
            out = []
            for r in rows:
                d = dict(r)
                d["obligations"] = json.loads(d["obligations"] or "[]")
                d["delegation_chain"] = json.loads(d["delegation_chain"] or "[]")
                out.append(d)
            return out
