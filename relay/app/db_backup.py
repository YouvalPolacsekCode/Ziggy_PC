"""Nightly encrypted backup of the relay SQLite DB to Backblaze B2.

DESIGN_BACKUP_DR.md §13 Chunk #8.

The relay holds wrapped_data_key + wrapped_b2_credentials for every home.
Losing /data/relay.db means every customer backup becomes permanently
undecryptable — single point of failure. This pipeline mitigates by
nightly-snapshotting the DB, encrypting with a dedicated relay backup
key, and pushing to a SEPARATE B2 bucket from the per-home backups.

------------------------------------------------------------------------
Key model (resolves the §11 / §13 Chunk #8 ambiguity):
------------------------------------------------------------------------
§11 states "Master key never lives on relay." §13 Chunk #8 says
"encrypt with founder master key." Those conflict for automated
nightly backups. We resolve by using a DEDICATED relay backup key:

  RELAY_BACKUP_KEY env var holds a 32-byte AES-256-GCM key,
  base64-encoded. The founder:
    (a) generates once with `head -c 32 /dev/urandom | base64`
    (b) stores a copy in 1Password alongside the per-home master key
    (c) injects into Fly via `fly secrets set RELAY_BACKUP_KEY=<...>`

The relay-backup key is NEVER the per-home wrap master key. Per-home
data remains undecryptable even if the relay env is fully compromised:
  - wrapped_data_key rows in relay.db are still wrapped with the
    per-home master (which lives only in 1Password)
  - the relay-backup key only decrypts the relay.db snapshot itself —
    it gives an attacker every home's wrapped_data_key (still ciphertext)
    but not the per-home master needed to unwrap them.

This is a strict improvement over the §13 Chunk #8 literal reading.
Founder review pending — see PR description.

------------------------------------------------------------------------
Crypto:
------------------------------------------------------------------------
AES-256-GCM with a 12-byte random nonce and a 16-byte tag. Output is
`nonce || ciphertext || tag` — exactly the wire format produced by
services/backup_keys.wrap() on the edge agent. Restore tooling can
decrypt either shape with the same primitives. (backup_keys.wrap is
specialized for 32-byte plaintext data keys; this module's wrap()
takes arbitrary-size plaintext, since the SQLite snapshot is MBs.)

------------------------------------------------------------------------
Storage:
------------------------------------------------------------------------
Bucket:  ziggy-relay-backups   (separate from ziggy-backups-prod)
Layout:
  daily/YYYY-MM-DD/relay.db.enc      one per day
  weekly/YYYY-Www/relay.db.enc       promoted from daily on Sundays
  latest/relay.db.enc                server-side copy after each daily

Retention is enforced in the B2 console, not by this code:
  daily/*   keep 14 most recent versions
  weekly/*  keep 8 most recent versions
  latest/*  always overwritten by the next daily

------------------------------------------------------------------------
CLI:
------------------------------------------------------------------------
  python -m relay.app.db_backup --once
  python -m relay.app.db_backup --once --dry-run

Scheduling is external (Fly machine cron / systemd timer / GitHub Action).
The pipeline is idempotent per calendar day: re-running on the same
date overwrites that day's blob.

------------------------------------------------------------------------
Restore (documented, no script):
------------------------------------------------------------------------
1. Provision a new Fly machine + volume.
2. Set RELAY_BACKUP_KEY env var on the new machine (paste from 1Password).
3. Download the latest blob from B2:
     aws s3 cp s3://ziggy-relay-backups/latest/relay.db.enc /tmp/ \\
       --endpoint-url=https://s3.eu-central-003.backblazeb2.com
4. Decrypt with unwrap() — e.g. a one-liner Python:
     from relay.app.db_backup import unwrap, load_relay_backup_key
     open("/data/relay.db", "wb").write(
         unwrap(load_relay_backup_key(), open("/tmp/relay.db.enc","rb").read()))
5. Restart relay. Per-home backups continue working because the wrapped
   key material is intact in /data/relay.db.

Step-by-step procedure lives in RUNBOOK_DR.md (Chunk #11).
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import logging
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Optional

import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

log = logging.getLogger(__name__)


# Wire-format constants — must match services/backup_keys.py.
_NONCE = 12
_KEY = 32
_TAG = 16

BUCKET = "ziggy-relay-backups"
DEFAULT_ENDPOINT = "https://s3.eu-central-003.backblazeb2.com"

_LATEST_KEY = "latest/relay.db.enc"


# ---------- key + crypto ----------

def load_relay_backup_key() -> bytes:
    """Read RELAY_BACKUP_KEY env var. Strict on length + encoding."""
    raw = os.environ.get("RELAY_BACKUP_KEY", "")
    if not raw:
        raise RuntimeError(
            "RELAY_BACKUP_KEY env var missing. Generate with "
            "`head -c 32 /dev/urandom | base64` and set on the relay env. "
            "Store a copy in 1Password — losing this key makes the relay "
            "DB backups undecryptable."
        )
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as e:
        raise RuntimeError(f"RELAY_BACKUP_KEY is not valid base64: {e}") from e
    if len(key) != _KEY:
        raise RuntimeError(
            f"RELAY_BACKUP_KEY must decode to {_KEY} bytes, got {len(key)}"
        )
    return key


def wrap(key: bytes, plaintext: bytes) -> bytes:
    """AES-256-GCM encrypt. Returns nonce(12) || ciphertext || tag(16).

    Wire-compatible with services/backup_keys.wrap() on the edge agent —
    the difference is only that backup_keys.wrap is specialized for
    32-byte plaintext (data keys), while this takes arbitrary size.
    """
    if not isinstance(key, (bytes, bytearray)) or len(key) != _KEY:
        raise ValueError(f"key must be {_KEY} bytes, got {len(key) if hasattr(key,'__len__') else type(key).__name__}")
    nonce = os.urandom(_NONCE)
    ct = AESGCM(bytes(key)).encrypt(nonce, plaintext, None)
    return nonce + ct


def unwrap(key: bytes, wrapped: bytes) -> bytes:
    """Inverse of wrap(). Raises InvalidTag on wrong key or tamper.

    Used both by the relay's own restore procedure and by any external
    operator doing a manual disaster restore from B2.
    """
    if not isinstance(key, (bytes, bytearray)) or len(key) != _KEY:
        raise ValueError(f"key must be {_KEY} bytes")
    if len(wrapped) < _NONCE + _TAG:
        raise ValueError("wrapped blob too short")
    nonce = bytes(wrapped[:_NONCE])
    body = bytes(wrapped[_NONCE:])
    return AESGCM(bytes(key)).decrypt(nonce, body, None)


# ---------- SQLite online snapshot ----------

def snapshot_sqlite(src: str) -> bytes:
    """sqlite3 online .backup → bytes.

    Uses the online backup API so a snapshot taken under live writer load
    is internally consistent (no half-write tears). Returns the snapshot
    file contents as bytes — caller owns the lifetime.
    """
    src_conn = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            tmp_path = tf.name
        try:
            dst_conn = sqlite3.connect(tmp_path)
            try:
                src_conn.backup(dst_conn)
            finally:
                dst_conn.close()
            return Path(tmp_path).read_bytes()
        finally:
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass
    finally:
        src_conn.close()


# ---------- B2 client ----------

def _b2_client():
    """Build the boto3 S3 client. Credentials from RELAY_B2_KEY_ID + _APP_KEY.

    The B2 application key MUST be prefix-scoped to the ziggy-relay-backups
    bucket only — NEVER reuse the per-home backups bucket app key here.
    A relay-side compromise should not give read access to customer data.
    """
    endpoint = os.environ.get("RELAY_B2_ENDPOINT", DEFAULT_ENDPOINT)
    key_id = os.environ.get("RELAY_B2_KEY_ID", "")
    app_key = os.environ.get("RELAY_B2_APP_KEY", "")
    if not key_id or not app_key:
        raise RuntimeError(
            "RELAY_B2_KEY_ID and RELAY_B2_APP_KEY must both be set "
            "on the relay env (separate from per-home backup credentials)."
        )
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=app_key,
    )


# ---------- object key helpers ----------

def _daily_key(date: dt.date) -> str:
    return f"daily/{date.isoformat()}/relay.db.enc"


def _weekly_key(date: dt.date) -> str:
    year, week, _ = date.isocalendar()
    return f"weekly/{year}-W{week:02d}/relay.db.enc"


# ---------- main pipeline ----------

def run_relay_db_backup(
    *,
    db_path: Optional[str] = None,
    today: Optional[dt.date] = None,
    dry_run: bool = False,
    storage_client=None,
    key: Optional[bytes] = None,
) -> dict:
    """One full backup cycle. Returns a result dict.

    The dict shape:
      {ok, stage, plaintext_bytes, encrypted_bytes, daily_key,
       latest_updated, promoted_weekly_key, error}

    stage transitions:  snapshot → encrypt → upload → promote → done

    Failures land in result["error"] rather than raising — the CLI
    surfaces this via exit code 1, scheduled callers via a metric.

    Test injection points:
      `storage_client`  pass a MagicMock to skip the real B2 client
      `key`             pass a known 32-byte key to skip env lookup
      `db_path`         pass a tmp_path SQLite to skip /data/relay.db
      `today`           freeze the date for deterministic key paths
    """
    result: dict = {
        "ok": False,
        "stage": "snapshot",
        "plaintext_bytes": 0,
        "encrypted_bytes": 0,
        "daily_key": None,
        "latest_updated": False,
        "promoted_weekly_key": None,
        "error": None,
    }
    try:
        db_path = db_path or os.environ.get("DATABASE_URL", "/data/relay.db")
        today = today or dt.date.today()
        eff_key = key if key is not None else load_relay_backup_key()
        client = storage_client if storage_client is not None else _b2_client()

        plaintext = snapshot_sqlite(db_path)
        result["plaintext_bytes"] = len(plaintext)

        result["stage"] = "encrypt"
        blob = wrap(eff_key, plaintext)
        result["encrypted_bytes"] = len(blob)

        daily_key = _daily_key(today)
        result["daily_key"] = daily_key

        result["stage"] = "upload"
        if not dry_run:
            client.put_object(Bucket=BUCKET, Key=daily_key, Body=blob)
            # Latest pointer — server-side copy, no extra egress.
            client.copy_object(
                Bucket=BUCKET, Key=_LATEST_KEY,
                CopySource={"Bucket": BUCKET, "Key": daily_key},
            )
            result["latest_updated"] = True

        result["stage"] = "promote"
        # Sunday → also create a weekly copy. weekday() returns 0..6 with 6=Sun.
        if today.weekday() == 6 and not dry_run:
            weekly_key = _weekly_key(today)
            client.copy_object(
                Bucket=BUCKET, Key=weekly_key,
                CopySource={"Bucket": BUCKET, "Key": daily_key},
            )
            result["promoted_weekly_key"] = weekly_key

        result["ok"] = True
        result["stage"] = "done"
        log.info(
            "relay backup ok daily=%s plaintext=%d encrypted=%d weekly=%s",
            daily_key, result["plaintext_bytes"], result["encrypted_bytes"],
            result["promoted_weekly_key"],
        )
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        log.error(
            "relay backup failed at stage=%s: %s", result["stage"], e,
            exc_info=True,
        )
    return result


# ---------- CLI ----------

def _main(argv=None) -> int:
    import argparse
    parser = argparse.ArgumentParser(
        prog="python -m relay.app.db_backup",
        description="Encrypt + upload one relay DB snapshot to Backblaze B2.",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="Run a single backup right now and exit. Required.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Snapshot + encrypt locally but skip the B2 upload.",
    )
    args = parser.parse_args(argv)
    if not args.once:
        parser.error("--once is required (no other modes yet).")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    result = run_relay_db_backup(dry_run=args.dry_run)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(_main())
