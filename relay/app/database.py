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

-- Telemetry ingestion (Prompt 2 §C). Edge agents POST every 5 min to
-- /api/devices/{device_id}/telemetry with HA / Ziggy versions, uptime,
-- sensor inventory + battery levels, disk/CPU/mem, container health,
-- last automation trigger. The relay never interprets the payload — it
-- writes it as JSON text and lets the admin dashboard parse on read.
--
-- Retention (relay/app/telemetry_retention.py runs daily):
--   telemetry_raw    — 30 days
--   telemetry_daily  — 365 days, aggregated from raw at end-of-day
--
-- Aggregation is one row per (home_id, day). last_seen_ts records the
-- newest sample inside that day's window so a stale aggregate is
-- detectable (no telemetry posted on day X → no row for day X).
CREATE TABLE IF NOT EXISTS telemetry_raw (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    home_id   TEXT    NOT NULL,
    ts        TEXT    NOT NULL,
    payload   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry_daily (
    home_id          TEXT    NOT NULL,
    day              TEXT    NOT NULL,        -- ISO date YYYY-MM-DD UTC
    ha_version       TEXT,                    -- last seen that day
    ziggy_version    TEXT,                    -- last seen that day
    uptime_avg_s     INTEGER,
    sensor_count_avg INTEGER,
    disk_pct_avg     REAL,
    cpu_pct_avg      REAL,
    mem_pct_avg      REAL,
    sample_count     INTEGER NOT NULL DEFAULT 0,
    last_seen_ts     TEXT,
    PRIMARY KEY (home_id, day)
);

-- OTA release catalog. Each row is an admin-authored target version that
-- hubs may converge to. Resolution at GET /api/devices/{device_id}/ota-manifest:
--   1. If homes.ota_pinned_release_id is set, return that release.
--   2. Otherwise return the most recent row by id DESC.
--   3. If the table is empty, the endpoint returns 404 — hubs treat that as
--      "no release published yet, no version delta, no action."
--
-- image_digests is stored as JSON text (a dict of image_name → digest).
-- Schema is opaque to the relay; the edge agent interprets it. See
-- relay/app/routers/ota.py for the documented field list.
CREATE TABLE IF NOT EXISTS ota_releases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ha_version      TEXT    NOT NULL,
    ziggy_version   TEXT    NOT NULL,
    image_digests   TEXT    NOT NULL,      -- JSON object
    notes           TEXT,
    created_at      TEXT    NOT NULL,
    created_by      TEXT
);

-- Staged-rollout cohorts (Prompt 4 chunk 2.H). A cohort is a named group of
-- homes that share the same target release. Resolution order at
-- GET /api/devices/{device_id}/ota-manifest:
--   1. homes.ota_pinned_release_id (per-home pin from Prompt 2)
--   2. home_cohorts.cohort_name → ota_release_cohorts.release_id (this chunk)
--   3. Most recent ota_releases row (global rollout)
--
-- A founder pins one home to a new release first, watches telemetry, then
-- creates / updates a small cohort to expand, finally lifts the cohort pin
-- (or just adds new releases — the cohort tracks whatever release_id the
-- admin sets, not "latest").
--
-- cohort_name is the PK so admins can refer to cohorts by stable name in
-- audit logs and admin tooling. The release_id FK is not enforced (PRAGMA
-- foreign_keys is OFF in this DB); the POST endpoint validates that the
-- release_id exists before writing.
CREATE TABLE IF NOT EXISTS ota_release_cohorts (
    cohort_name   TEXT    PRIMARY KEY,
    release_id    INTEGER NOT NULL,
    created_at    TEXT    NOT NULL,
    created_by    TEXT
);

-- home_cohorts: which cohort (if any) a home belongs to. PK on home_id
-- enforces "at most one cohort per home" — if an admin wants to move a
-- home, they PUT a new cohort_name (or NULL to unassign). ON DELETE
-- CASCADE means deprovisioning a home automatically removes its row.
CREATE TABLE IF NOT EXISTS home_cohorts (
    home_id      TEXT PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
    cohort_name  TEXT NOT NULL,
    assigned_at  TEXT NOT NULL,
    assigned_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_home     ON users(home_id);
CREATE INDEX IF NOT EXISTS idx_invites_token  ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_home   ON invites(home_id);
CREATE INDEX IF NOT EXISTS idx_audit_event    ON audit_log(event, ts);
CREATE INDEX IF NOT EXISTS idx_audit_home     ON audit_log(home_id, ts);
CREATE INDEX IF NOT EXISTS idx_ota_releases_created ON ota_releases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_raw_home_ts ON telemetry_raw(home_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_daily_day ON telemetry_daily(day);
CREATE INDEX IF NOT EXISTS idx_home_cohorts_cohort  ON home_cohorts(cohort_name);
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
        # Per-home OTA pin (Prompt 2 Chunk #2). NULL = use the most recent
        # release. Foreign-key not enforced (pragma foreign_keys is OFF in
        # this DB) — the pin endpoint validates the release_id exists
        # before writing, and a release deletion path that orphans pins
        # does not exist today.
        rows = await db.execute_fetchall("PRAGMA table_info(homes)")
        home_cols = {r[1] for r in rows}
        if "ota_pinned_release_id" not in home_cols:
            await db.execute(
                "ALTER TABLE homes ADD COLUMN ota_pinned_release_id INTEGER"
            )
        await db.commit()


@asynccontextmanager
async def get_db():
    async with aiosqlite.connect(DATABASE_URL) as db:
        db.row_factory = aiosqlite.Row
        yield db
