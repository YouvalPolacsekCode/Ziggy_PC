"""Durable chat-thread store — server-side conversations that persist and resume.

Makes a Ziggy conversation a real object (id, title, messages, status) saved to
SQLite, so a thread survives page reload / navigation and can run in the background
and be returned to (like Claude/ChatGPT). Applies to ALL chats, not just the fixer.

Follows the repo convention: shared SQLite at user_files/home_map.db, CREATE TABLE
IF NOT EXISTS on connect, a module lock (see services/self_heal.py).
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path

_DB_PATH = Path(os.environ.get("ZIGGY_CHAT_DB", "user_files/home_map.db"))
_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_threads (
    thread_id  TEXT PRIMARY KEY,
    title      TEXT,
    owner      TEXT,
    status     TEXT DEFAULT 'idle',
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT,
    role      TEXT,
    content   TEXT,
    data      TEXT,
    ts        REAL
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_thread ON chat_messages(thread_id, id);
"""

_TITLE_MAX = 40


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)   # idempotent
    return conn


def _title_from(text: str) -> str:
    t = " ".join((text or "").split())
    if not t:
        return "New chat"
    return t[:_TITLE_MAX] + "…" if len(t) > _TITLE_MAX else t


def create_thread(owner: str | None = None, title: str | None = None) -> str:
    tid = "th_" + uuid.uuid4().hex[:16]
    now = time.time()
    with _lock, _connect() as c:
        c.execute(
            "INSERT INTO chat_threads(thread_id,title,owner,status,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?)",
            (tid, title, owner, "idle", now, now),
        )
    return tid


def ensure_thread(thread_id: str, owner: str | None = None) -> str:
    """Create the thread with this exact id if it doesn't exist (idempotent).

    Lets /api/chat accept a client-supplied thread id and 'get-or-create' it, so a
    first message doesn't need a separate create round-trip.
    """
    now = time.time()
    with _lock, _connect() as c:
        row = c.execute("SELECT thread_id FROM chat_threads WHERE thread_id=?",
                        (thread_id,)).fetchone()
        if row:
            return thread_id
        c.execute(
            "INSERT INTO chat_threads(thread_id,title,owner,status,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?)",
            (thread_id, None, owner, "idle", now, now),
        )
    return thread_id


def append_message(thread_id: str, role: str, content: str,
                   data: dict | None = None) -> int:
    now = time.time()
    with _lock, _connect() as c:
        cur = c.execute(
            "INSERT INTO chat_messages(thread_id,role,content,data,ts) VALUES(?,?,?,?,?)",
            (thread_id, role, content, json.dumps(data) if data is not None else None, now),
        )
        mid = cur.lastrowid
        row = c.execute("SELECT title FROM chat_threads WHERE thread_id=?", (thread_id,)).fetchone()
        if row is not None:
            title = row["title"]
            if not title and role == "user":
                title = _title_from(content)
            c.execute("UPDATE chat_threads SET updated_at=?, title=? WHERE thread_id=?",
                      (now, title, thread_id))
    return mid


def set_status(thread_id: str, status: str) -> None:
    with _lock, _connect() as c:
        c.execute("UPDATE chat_threads SET status=?, updated_at=? WHERE thread_id=?",
                  (status, time.time(), thread_id))


def rename_thread(thread_id: str, title: str) -> None:
    with _lock, _connect() as c:
        c.execute("UPDATE chat_threads SET title=? WHERE thread_id=?", (title, thread_id))


def delete_thread(thread_id: str) -> None:
    with _lock, _connect() as c:
        c.execute("DELETE FROM chat_messages WHERE thread_id=?", (thread_id,))
        c.execute("DELETE FROM chat_threads WHERE thread_id=?", (thread_id,))


def get_thread(thread_id: str) -> dict | None:
    with _lock, _connect() as c:
        t = c.execute("SELECT * FROM chat_threads WHERE thread_id=?", (thread_id,)).fetchone()
        if not t:
            return None
        msgs = c.execute(
            "SELECT role,content,data,ts FROM chat_messages WHERE thread_id=? ORDER BY id",
            (thread_id,),
        ).fetchall()
    return {
        "thread_id": t["thread_id"],
        "title": t["title"] or "New chat",
        "owner": t["owner"],
        "status": t["status"],
        "created_at": t["created_at"],
        "updated_at": t["updated_at"],
        "messages": [
            {"role": m["role"], "content": m["content"],
             "data": json.loads(m["data"]) if m["data"] else None, "ts": m["ts"]}
            for m in msgs
        ],
    }


def list_threads(owner: str | None = None, limit: int = 50) -> list[dict]:
    with _lock, _connect() as c:
        if owner is None:
            rows = c.execute(
                "SELECT * FROM chat_threads ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM chat_threads WHERE owner=? ORDER BY updated_at DESC LIMIT ?",
                (owner, limit),
            ).fetchall()
        out = []
        for t in rows:
            last = c.execute(
                "SELECT content FROM chat_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1",
                (t["thread_id"],),
            ).fetchone()
            out.append({
                "thread_id": t["thread_id"],
                "title": t["title"] or "New chat",
                "status": t["status"],
                "updated_at": t["updated_at"],
                "preview": (last["content"][:80] if last and last["content"] else ""),
            })
    return out


def get_history_for_agent(thread_id: str) -> list[dict]:
    """Return [{role, content}] for user/assistant turns — the shape run_agent wants."""
    th = get_thread(thread_id)
    if not th:
        return []
    return [{"role": m["role"], "content": m["content"]}
            for m in th["messages"] if m["role"] in ("user", "assistant")]
