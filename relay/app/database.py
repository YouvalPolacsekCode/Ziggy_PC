from __future__ import annotations

import aiosqlite
import os
from contextlib import asynccontextmanager

DATABASE_URL = os.getenv("DATABASE_URL", "/data/relay.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS homes (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'cloud',
    tunnel_url  TEXT,
    status      TEXT NOT NULL DEFAULT 'provisioning',
    relay_secret TEXT NOT NULL,
    cf_tunnel_id TEXT,
    created_at  TEXT NOT NULL,
    owner_email TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt         TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    home_id      TEXT REFERENCES homes(id) ON DELETE CASCADE,
    session_token TEXT,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
    token       TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    email       TEXT,
    role        TEXT NOT NULL,
    home_id     TEXT REFERENCES homes(id) ON DELETE CASCADE,
    home_name   TEXT,
    invited_by  TEXT,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    accepted    INTEGER NOT NULL DEFAULT 0,
    accepted_at TEXT,
    accepted_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL,
    event       TEXT    NOT NULL,
    home_id     TEXT,
    source_ip   TEXT,
    ok          INTEGER NOT NULL DEFAULT 0,
    detail      TEXT
);

-- Per-home wrapped key material for the encrypted backup pipeline.
-- See DESIGN_BACKUP_DR.md §4 (envelope encryption) and §10 (this schema).
--
-- Both wrapped_* columns store a single nonce(12) || ciphertext || tag(16)
-- blob — the exact bytes returned by services.backup_keys.wrap() on the
-- edge agent. Concatenating nonce+ciphertext+tag inside one column makes
-- nonce reuse impossible at the use site (impossible to pair the wrong
-- nonce with the wrong ciphertext). For wrapped_data_key the blob is
-- always 60 bytes (12+32+16); for wrapped_b2_credentials it varies with
-- the JSON-encoded {b2_key_id, b2_app_key} payload length.
--
-- last_unsealed_at / last_unsealed_by are NULL until the first founder
-- unseal happens (Chunk #7 endpoint), at which point they're populated
-- and a 'backup_key_unsealed' row also lands in audit_log.
CREATE TABLE IF NOT EXISTS home_backup_keys (
    home_id                TEXT    PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
    wrapped_data_key       BLOB    NOT NULL,
    wrapped_b2_credentials BLOB    NOT NULL,
    key_version            INTEGER NOT NULL DEFAULT 1,
    created_at             TEXT    NOT NULL,
    last_unsealed_at       TEXT,
    last_unsealed_by       TEXT    REFERENCES users(email)
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_home     ON users(home_id);
CREATE INDEX IF NOT EXISTS idx_invites_token  ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_home   ON invites(home_id);
CREATE INDEX IF NOT EXISTS idx_audit_event    ON audit_log(event, ts);
CREATE INDEX IF NOT EXISTS idx_audit_home     ON audit_log(home_id, ts);
"""

# Audit event names that Chunk #7's backup endpoints will emit. The
# audit_log.event column is plain TEXT — these are documented here so the
# event-name set stays in one place rather than being scattered string
# literals across router handlers.
#
# See DESIGN_BACKUP_DR.md §10 for the full payload shape per event.
BACKUP_AUDIT_EVENTS = (
    "backup_key_sealed",        # factory imaging finished initial seal
    "backup_key_unsealed",      # founder unwrapped data_key for restore
    "backup_status_updated",    # hub reported successful daily backup
    "restore_completed",        # new hub finished DR
    "restore_aborted",          # restore failed mid-flow
)


async def init_db():
    os.makedirs(os.path.dirname(DATABASE_URL), exist_ok=True)
    async with aiosqlite.connect(DATABASE_URL) as db:
        await db.executescript(SCHEMA)
        # Idempotent column addition for pre-Task-4 deployments. CREATE TABLE
        # IF NOT EXISTS leaves an existing users table alone, so the column
        # must be added by a conditional ALTER.
        rows = await db.execute_fetchall("PRAGMA table_info(users)")
        cols = {r[1] for r in rows}
        if "hash_algo" not in cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN hash_algo TEXT NOT NULL DEFAULT 'hmac_sha256'"
            )
        await db.commit()


@asynccontextmanager
async def get_db():
    async with aiosqlite.connect(DATABASE_URL) as db:
        db.row_factory = aiosqlite.Row
        yield db
