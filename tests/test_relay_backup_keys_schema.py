"""Tests for the relay-side home_backup_keys schema (Chunk #6).

Verifies the table created in relay/app/database.py matches the shape
DESIGN_BACKUP_DR.md §10 specifies after the single-blob amendment:
single-column wrapped_data_key + wrapped_b2_credentials (each holding
nonce||ct||tag), one row per home, FK-cascaded to homes, columns of
the correct type and NOT NULL constraints where intended.

Each test gets a fresh tmp_path SQLite file. The fixture monkeypatches
the module-level DATABASE_URL so init_db() lands inside tmp_path.
"""
from __future__ import annotations

import datetime as dt

import pytest

from relay.app import database as dbmod


# pytest-asyncio is in `auto` mode per pytest.ini — async tests just work.


@pytest.fixture
async def relay_db(tmp_path, monkeypatch):
    """Fresh relay DB at tmp_path/relay.db. Returns the dbmod with URL patched."""
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


async def _insert_home(db, home_id: str = "home-x", relay_secret: str = "secret") -> None:
    await db.execute(
        "INSERT INTO homes(id, name, type, relay_secret, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (home_id, home_id.upper(), "hub", relay_secret, "2026-05-27T00:00:00Z"),
    )


# ---------- schema shape ----------

async def test_home_backup_keys_table_exists(relay_db):
    async with relay_db.get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='home_backup_keys'"
        )
    assert len(rows) == 1


async def test_columns_match_design(relay_db):
    """Single-blob shape per amended §10 — no separate nonce columns."""
    async with relay_db.get_db() as db:
        rows = await db.execute_fetchall("PRAGMA table_info(home_backup_keys)")
        cols = {r["name"]: (r["type"], bool(r["notnull"]), bool(r["pk"])) for r in rows}
    assert cols == {
        "home_id":                ("TEXT",    False, True),
        "wrapped_data_key":       ("BLOB",    True,  False),
        "wrapped_b2_credentials": ("BLOB",    True,  False),
        "key_version":            ("INTEGER", True,  False),
        "created_at":             ("TEXT",    True,  False),
        "last_unsealed_at":       ("TEXT",    False, False),
        "last_unsealed_by":       ("TEXT",    False, False),
    }
    # Belt-and-braces: confirm there's no leftover nonce column from the
    # pre-amendment design.
    assert "wrap_nonce" not in cols
    assert "b2_creds_nonce" not in cols


async def test_audit_event_names_documented(relay_db):
    """All five event names from DESIGN_BACKUP_DR.md §10 are exported."""
    assert relay_db.BACKUP_AUDIT_EVENTS == (
        "backup_key_sealed",
        "backup_key_unsealed",
        "backup_status_updated",
        "restore_completed",
        "restore_aborted",
    )


# ---------- insert + read back ----------

async def test_insert_and_read_back(relay_db):
    async with relay_db.get_db() as db:
        await _insert_home(db)
        wrapped_dk = b"\x01\x02\x03" * 20  # 60 bytes
        wrapped_b2 = b"\x10" * 100         # variable
        await db.execute(
            """INSERT INTO home_backup_keys
                (home_id, wrapped_data_key, wrapped_b2_credentials,
                 key_version, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            ("home-x", wrapped_dk, wrapped_b2, 1, "2026-05-27T00:00:00Z"),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM home_backup_keys WHERE home_id = ?", ("home-x",)
        )
    assert len(rows) == 1
    row = rows[0]
    assert row["wrapped_data_key"] == wrapped_dk
    assert row["wrapped_b2_credentials"] == wrapped_b2
    assert row["key_version"] == 1
    assert row["created_at"] == "2026-05-27T00:00:00Z"
    assert row["last_unsealed_at"] is None
    assert row["last_unsealed_by"] is None


async def test_variable_size_b2_blob_round_trips(relay_db):
    """B2 credentials blob has variable size (JSON-encoded creds). Verify
    round-trip is exact for a realistic payload size."""
    import json
    creds = {"b2_key_id": "K005abc" * 4, "b2_app_key": "x" * 64}
    # Wrapped shape ≈ 12 (nonce) + len(json) (ct) + 16 (tag)
    fake_wrapped = b"\x00" * 12 + json.dumps(creds).encode() + b"\x00" * 16
    async with relay_db.get_db() as db:
        await _insert_home(db)
        await db.execute(
            """INSERT INTO home_backup_keys
                (home_id, wrapped_data_key, wrapped_b2_credentials, key_version, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            ("home-x", b"\x00" * 60, fake_wrapped, 1, "now"),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT wrapped_b2_credentials FROM home_backup_keys WHERE home_id = ?",
            ("home-x",),
        )
    assert rows[0]["wrapped_b2_credentials"] == fake_wrapped


async def test_pk_enforces_one_row_per_home(relay_db):
    """home_id PRIMARY KEY → second insert with same home_id raises."""
    async with relay_db.get_db() as db:
        await _insert_home(db)
        await db.execute(
            """INSERT INTO home_backup_keys
                (home_id, wrapped_data_key, wrapped_b2_credentials, key_version, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            ("home-x", b"a" * 60, b"b" * 100, 1, "now"),
        )
        await db.commit()
        with pytest.raises(Exception):  # aiosqlite raises sqlite3.IntegrityError
            await db.execute(
                """INSERT INTO home_backup_keys
                    (home_id, wrapped_data_key, wrapped_b2_credentials, key_version, created_at)
                    VALUES (?, ?, ?, ?, ?)""",
                ("home-x", b"c" * 60, b"d" * 100, 2, "later"),
            )
            await db.commit()


# ---------- foreign key behavior (requires PRAGMA foreign_keys=ON) ----------

async def test_fk_cascade_when_home_deleted(relay_db):
    """ON DELETE CASCADE: removing the home wipes its backup key row.

    SQLite ships with foreign_keys=OFF by default; the test turns it on
    explicitly so the documented cascade is exercised. Production code
    that cares about FK enforcement should enable the pragma at connect
    time too — flagged as a future-work item.
    """
    async with relay_db.get_db() as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await _insert_home(db)
        await db.execute(
            """INSERT INTO home_backup_keys
                (home_id, wrapped_data_key, wrapped_b2_credentials, key_version, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            ("home-x", b"a" * 60, b"b" * 100, 1, "now"),
        )
        await db.commit()
        await db.execute("DELETE FROM homes WHERE id = ?", ("home-x",))
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM home_backup_keys WHERE home_id = ?", ("home-x",)
        )
    assert rows == []


async def test_unseal_fields_can_be_populated(relay_db):
    """last_unsealed_at + last_unsealed_by accept timestamp + email on update."""
    async with relay_db.get_db() as db:
        await _insert_home(db)
        await db.execute(
            """INSERT INTO home_backup_keys
                (home_id, wrapped_data_key, wrapped_b2_credentials, key_version, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            ("home-x", b"a" * 60, b"b" * 100, 1, "2026-05-27T00:00:00Z"),
        )
        # users table needs the founder row for the FK target to exist:
        await db.execute(
            """INSERT INTO users(id, email, password_hash, salt, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)""",
            ("u1", "founder@example.com", "h", "s", "super_admin", "now"),
        )
        await db.execute(
            """UPDATE home_backup_keys
                SET last_unsealed_at = ?, last_unsealed_by = ?
                WHERE home_id = ?""",
            ("2026-05-27T02:30:00Z", "founder@example.com", "home-x"),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT last_unsealed_at, last_unsealed_by FROM home_backup_keys WHERE home_id=?",
            ("home-x",),
        )
    assert rows[0]["last_unsealed_at"] == "2026-05-27T02:30:00Z"
    assert rows[0]["last_unsealed_by"] == "founder@example.com"


# ---------- idempotency ----------

async def test_init_db_idempotent(relay_db):
    """Calling init_db twice does not error or drop existing rows."""
    async with relay_db.get_db() as db:
        await _insert_home(db, "home-keep")
        await db.execute(
            """INSERT INTO home_backup_keys
                (home_id, wrapped_data_key, wrapped_b2_credentials, key_version, created_at)
                VALUES (?, ?, ?, ?, ?)""",
            ("home-keep", b"a" * 60, b"b" * 100, 1, "now"),
        )
        await db.commit()
    # Re-init should be a no-op.
    await relay_db.init_db()
    await relay_db.init_db()
    async with relay_db.get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT home_id FROM home_backup_keys WHERE home_id=?", ("home-keep",)
        )
    assert len(rows) == 1


async def test_init_db_creates_all_tables(relay_db):
    """Sanity: every expected table is present after init_db()."""
    async with relay_db.get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'"
        )
        names = {r["name"] for r in rows}
    assert names == {
        "homes", "users", "invites", "audit_log", "home_backup_keys",
        # Prompt 2 chunk 2.1 + 2.3:
        "ota_releases", "telemetry_raw", "telemetry_daily",
        # Prompt 4 chunk 2.H (staged-rollout cohorts):
        "ota_release_cohorts", "home_cohorts",
        # Prompt 9 chunk 2 (Stripe billing):
        "founder_slots", "processed_webhooks", "invoice_sequence",
    }
