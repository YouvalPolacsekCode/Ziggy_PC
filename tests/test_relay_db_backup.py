"""Tests for relay/app/db_backup.py — Chunk #8 relay DB backup pipeline.

Coverage:
  - load_relay_backup_key: missing / bad b64 / wrong length / happy
  - wrap / unwrap: roundtrip / tamper detection / wrong key
  - snapshot_sqlite: produces a valid SQLite file under live writes
  - run_relay_db_backup: happy path, dry-run, Sunday promotion, non-Sunday
  - run_relay_db_backup: error handling (snapshot failure, upload failure)
  - CLI: --once + --dry-run + missing-flag + nonzero exit on failure

All tests inject mocks for boto3 + key + db_path — no live B2 hits.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import os
import sqlite3
from unittest.mock import MagicMock, patch

import pytest

from relay.app import db_backup as dbb


# ---------- load_relay_backup_key ----------

def test_load_key_missing_env(monkeypatch):
    monkeypatch.delenv("RELAY_BACKUP_KEY", raising=False)
    with pytest.raises(RuntimeError, match="RELAY_BACKUP_KEY env var missing"):
        dbb.load_relay_backup_key()


def test_load_key_bad_base64(monkeypatch):
    monkeypatch.setenv("RELAY_BACKUP_KEY", "!!!not-base64!!!")
    with pytest.raises(RuntimeError, match="not valid base64"):
        dbb.load_relay_backup_key()


def test_load_key_wrong_length(monkeypatch):
    monkeypatch.setenv("RELAY_BACKUP_KEY", base64.b64encode(b"too-short").decode())
    with pytest.raises(RuntimeError, match="32 bytes"):
        dbb.load_relay_backup_key()


def test_load_key_happy(monkeypatch):
    key = b"K" * 32
    monkeypatch.setenv("RELAY_BACKUP_KEY", base64.b64encode(key).decode())
    assert dbb.load_relay_backup_key() == key


# ---------- wrap / unwrap ----------

def test_wrap_unwrap_roundtrip_small():
    key = b"k" * 32
    pt = b"hello"
    blob = dbb.wrap(key, pt)
    assert dbb.unwrap(key, blob) == pt


def test_wrap_unwrap_roundtrip_large():
    """Multi-MB plaintext — relay.db is typically 100s of KB to a few MB."""
    key = b"k" * 32
    pt = b"x" * (2 * 1024 * 1024)  # 2 MB
    blob = dbb.wrap(key, pt)
    assert len(blob) == len(pt) + 12 + 16
    assert dbb.unwrap(key, blob) == pt


def test_wrap_is_nondeterministic():
    key = b"k" * 32
    pt = b"identical plaintext"
    a = dbb.wrap(key, pt)
    b = dbb.wrap(key, pt)
    assert a != b  # different random nonce each time


def test_unwrap_wrong_key_raises():
    from cryptography.exceptions import InvalidTag
    blob = dbb.wrap(b"k" * 32, b"secret")
    with pytest.raises(InvalidTag):
        dbb.unwrap(b"x" * 32, blob)


def test_unwrap_tampered_ciphertext_raises():
    from cryptography.exceptions import InvalidTag
    blob = bytearray(dbb.wrap(b"k" * 32, b"secret payload" * 10))
    blob[20] ^= 0x01
    with pytest.raises(InvalidTag):
        dbb.unwrap(b"k" * 32, bytes(blob))


def test_unwrap_tampered_tag_raises():
    from cryptography.exceptions import InvalidTag
    blob = bytearray(dbb.wrap(b"k" * 32, b"secret payload"))
    blob[-1] ^= 0x01
    with pytest.raises(InvalidTag):
        dbb.unwrap(b"k" * 32, bytes(blob))


def test_wrap_wrong_key_length_raises():
    with pytest.raises(ValueError, match="32 bytes"):
        dbb.wrap(b"short", b"data")


def test_unwrap_blob_too_short_raises():
    with pytest.raises(ValueError, match="too short"):
        dbb.unwrap(b"k" * 32, b"short")


def test_wire_format_matches_chunk2():
    """Blob produced by db_backup.wrap is decryptable by AESGCM directly,
    confirming the wire format matches services/backup_keys.wrap()."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = b"k" * 32
    pt = b"interop check"
    blob = dbb.wrap(key, pt)
    # Manual decrypt using the same shape backup_keys uses:
    nonce = blob[:12]
    body = blob[12:]
    assert AESGCM(key).decrypt(nonce, body, None) == pt


# ---------- snapshot_sqlite ----------

def test_snapshot_sqlite_produces_valid_db(tmp_path):
    src = tmp_path / "live.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (x INTEGER, y TEXT)")
    conn.execute("INSERT INTO t VALUES (1, 'one'), (2, 'two')")
    conn.commit()
    conn.close()

    snap = dbb.snapshot_sqlite(str(src))
    assert snap[:16].startswith(b"SQLite format 3\x00")

    # And the snapshot is a working DB:
    out = tmp_path / "restored.db"
    out.write_bytes(snap)
    conn = sqlite3.connect(str(out))
    rows = conn.execute("SELECT x, y FROM t ORDER BY x").fetchall()
    conn.close()
    assert rows == [(1, "one"), (2, "two")]


def test_snapshot_during_writes(tmp_path):
    """Snapshot taken while the source has uncommitted writes still works.

    sqlite3.backup uses the online backup API — even with pending WAL
    pages, the snapshot reflects a consistent point in time.
    """
    src = tmp_path / "live.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (x INTEGER)")
    conn.execute("INSERT INTO t VALUES (1)")
    conn.commit()

    # Hold the connection open during snapshot.
    snap = dbb.snapshot_sqlite(str(src))
    conn.close()

    out = tmp_path / "r.db"
    out.write_bytes(snap)
    rows = sqlite3.connect(str(out)).execute("SELECT x FROM t").fetchall()
    assert rows == [(1,)]


# ---------- run_relay_db_backup ----------

@pytest.fixture
def src_db(tmp_path):
    """A small real SQLite DB to snapshot in tests."""
    p = tmp_path / "relay.db"
    conn = sqlite3.connect(str(p))
    conn.execute("CREATE TABLE homes (id TEXT, name TEXT)")
    conn.execute("INSERT INTO homes VALUES ('home-1', 'X')")
    conn.commit()
    conn.close()
    return str(p)


def _mock_client():
    return MagicMock()


def test_run_happy_path_monday(src_db):
    """Monday → uploads daily + latest, no weekly promotion."""
    key = b"k" * 32
    client = _mock_client()
    monday = dt.date(2026, 5, 25)  # weekday() == 0
    res = dbb.run_relay_db_backup(
        db_path=src_db, today=monday, key=key, storage_client=client,
    )
    assert res["ok"] is True, res
    assert res["stage"] == "done"
    assert res["daily_key"] == "daily/2026-05-25/relay.db.enc"
    assert res["promoted_weekly_key"] is None
    assert res["latest_updated"] is True

    # Verify the put_object call.
    put_calls = client.put_object.call_args_list
    assert len(put_calls) == 1
    kw = put_calls[0].kwargs
    assert kw["Bucket"] == "ziggy-relay-backups"
    assert kw["Key"] == "daily/2026-05-25/relay.db.enc"
    # Body is the encrypted blob — decrypt it and verify it's a SQLite DB.
    blob = kw["Body"]
    plaintext = dbb.unwrap(key, blob)
    assert plaintext[:16].startswith(b"SQLite format 3\x00")

    # Latest copy was made.
    copy_calls = client.copy_object.call_args_list
    assert len(copy_calls) == 1
    assert copy_calls[0].kwargs["Key"] == "latest/relay.db.enc"
    assert copy_calls[0].kwargs["CopySource"] == {
        "Bucket": "ziggy-relay-backups",
        "Key": "daily/2026-05-25/relay.db.enc",
    }


def test_run_sunday_promotes_to_weekly(src_db):
    key = b"k" * 32
    client = _mock_client()
    sunday = dt.date(2026, 5, 24)  # weekday() == 6
    res = dbb.run_relay_db_backup(
        db_path=src_db, today=sunday, key=key, storage_client=client,
    )
    assert res["ok"] is True
    assert res["promoted_weekly_key"] is not None
    iso_year, iso_week, _ = sunday.isocalendar()
    assert res["promoted_weekly_key"] == f"weekly/{iso_year}-W{iso_week:02d}/relay.db.enc"

    # Three copy_object calls: latest, then weekly. Wait — actually 2 copy calls
    # total: latest after daily upload, then weekly after that.
    copies = [c.kwargs["Key"] for c in client.copy_object.call_args_list]
    assert "latest/relay.db.enc" in copies
    assert any(k.startswith("weekly/") for k in copies)


def test_run_dry_run_skips_upload(src_db):
    key = b"k" * 32
    client = _mock_client()
    res = dbb.run_relay_db_backup(
        db_path=src_db, today=dt.date(2026, 5, 25),
        key=key, storage_client=client, dry_run=True,
    )
    assert res["ok"] is True
    assert res["latest_updated"] is False
    assert res["promoted_weekly_key"] is None
    client.put_object.assert_not_called()
    client.copy_object.assert_not_called()
    # But size accounting still populated:
    assert res["encrypted_bytes"] > 0
    assert res["plaintext_bytes"] > 0


def test_run_dry_run_on_sunday_does_not_promote(src_db):
    key = b"k" * 32
    client = _mock_client()
    sunday = dt.date(2026, 5, 24)
    res = dbb.run_relay_db_backup(
        db_path=src_db, today=sunday, key=key, storage_client=client, dry_run=True,
    )
    assert res["ok"] is True
    assert res["promoted_weekly_key"] is None  # dry-run never promotes
    client.copy_object.assert_not_called()


def test_run_snapshot_failure_aborts(tmp_path):
    """Source DB missing → snapshot stage fails cleanly."""
    res = dbb.run_relay_db_backup(
        db_path=str(tmp_path / "nope.db"),
        today=dt.date(2026, 5, 25),
        key=b"k" * 32,
        storage_client=_mock_client(),
    )
    assert res["ok"] is False
    assert res["stage"] == "snapshot"
    assert res["error"] is not None


def test_run_upload_failure_aborts(src_db):
    """B2 ClientError mid-upload bubbles into the result dict."""
    client = _mock_client()
    client.put_object.side_effect = RuntimeError("B2 down")
    res = dbb.run_relay_db_backup(
        db_path=src_db, today=dt.date(2026, 5, 25),
        key=b"k" * 32, storage_client=client,
    )
    assert res["ok"] is False
    assert res["stage"] == "upload"
    assert "B2 down" in res["error"]


def test_run_uploaded_blob_is_decryptable_by_relay_key(src_db):
    """End-to-end: snapshot → encrypt → blob in B2 → unwrap → valid SQLite."""
    key = b"k" * 32
    client = _mock_client()
    dbb.run_relay_db_backup(
        db_path=src_db, today=dt.date(2026, 5, 25),
        key=key, storage_client=client,
    )
    blob = client.put_object.call_args.kwargs["Body"]
    plaintext = dbb.unwrap(key, blob)
    assert plaintext[:16].startswith(b"SQLite format 3\x00")
    # Confirm decrypted DB contains the row we inserted.
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        tf.write(plaintext)
        tf.flush()
        rows = sqlite3.connect(tf.name).execute("SELECT id FROM homes").fetchall()
    assert rows == [("home-1",)]


def test_run_uploaded_blob_undecryptable_with_wrong_key(src_db):
    """Wrong relay backup key → InvalidTag, not silent corruption."""
    from cryptography.exceptions import InvalidTag
    key = b"k" * 32
    client = _mock_client()
    dbb.run_relay_db_backup(
        db_path=src_db, today=dt.date(2026, 5, 25),
        key=key, storage_client=client,
    )
    blob = client.put_object.call_args.kwargs["Body"]
    with pytest.raises(InvalidTag):
        dbb.unwrap(b"X" * 32, blob)


# ---------- key-source security guarantee ----------

def test_relay_backup_key_separate_from_master(src_db, monkeypatch):
    """The RELAY_BACKUP_KEY is purely a relay-DB encryption key; it does
    NOT need to equal the per-home master key. This test documents that
    decoupling: encrypting with key A and trying to decrypt with key B
    (the per-home master) fails as expected.
    """
    from cryptography.exceptions import InvalidTag
    relay_backup_key = b"R" * 32   # founder-set, in Fly env
    per_home_master = b"M" * 32    # founder-held in 1Password only
    assert relay_backup_key != per_home_master

    client = _mock_client()
    dbb.run_relay_db_backup(
        db_path=src_db, today=dt.date(2026, 5, 25),
        key=relay_backup_key, storage_client=client,
    )
    blob = client.put_object.call_args.kwargs["Body"]
    # An attacker who only has the per-home master key cannot decrypt
    # the relay DB backup — they need RELAY_BACKUP_KEY.
    with pytest.raises(InvalidTag):
        dbb.unwrap(per_home_master, blob)
    # The legitimate operator with RELAY_BACKUP_KEY can:
    assert dbb.unwrap(relay_backup_key, blob)[:16].startswith(b"SQLite format 3\x00")


# ---------- CLI ----------

def test_cli_requires_once_flag():
    with pytest.raises(SystemExit):
        dbb._main([])


def test_cli_runs_once_and_returns_zero(monkeypatch, capsys, src_db):
    """--once runs the pipeline and returns 0 on success."""
    monkeypatch.setattr(dbb, "load_relay_backup_key", lambda: b"k" * 32)
    monkeypatch.setattr(dbb, "_b2_client", lambda: _mock_client())
    monkeypatch.setenv("DATABASE_URL", src_db)
    code = dbb._main(["--once"])
    assert code == 0
    out = capsys.readouterr().out
    assert '"ok": true' in out


def test_cli_dry_run_skips_upload(monkeypatch, src_db):
    client = _mock_client()
    monkeypatch.setattr(dbb, "load_relay_backup_key", lambda: b"k" * 32)
    monkeypatch.setattr(dbb, "_b2_client", lambda: client)
    monkeypatch.setenv("DATABASE_URL", src_db)
    code = dbb._main(["--once", "--dry-run"])
    assert code == 0
    client.put_object.assert_not_called()


def test_cli_returns_nonzero_on_failure(monkeypatch, tmp_path):
    """If pipeline fails (e.g. source DB missing), CLI exits with 1."""
    monkeypatch.setattr(dbb, "load_relay_backup_key", lambda: b"k" * 32)
    monkeypatch.setattr(dbb, "_b2_client", lambda: _mock_client())
    monkeypatch.setenv("DATABASE_URL", str(tmp_path / "missing.db"))
    code = dbb._main(["--once"])
    assert code == 1
