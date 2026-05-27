"""Tests for services/backup_engine.py — daily backup orchestrator.

Strategy: all real B2/HA/subprocess I/O is mocked. Filesystem operations
use tmp_path. The deterministic pieces (manifest format, HMAC sign/verify,
schema-version gating, allowlist filtering, recorder skip logic) are tested
directly. The orchestration (run_daily_backup end-to-end) is tested with
mocks for HA + storage; we assert which B2 keys were written and that the
result dict reflects what happened.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import tarfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from services import backup_engine as be
from services import backup_keys


# ---------- fixtures ----------

def _data_key() -> bytes:
    return bytes.fromhex("bb" * 32)


@pytest.fixture
def data_key():
    return _data_key()


@pytest.fixture
def ha_dir(tmp_path):
    """Build a fake ha-config/ tree with allowlisted + non-allowlisted files."""
    d = tmp_path / "ha-config"
    d.mkdir()
    # Allowlisted top-level files
    (d / "configuration.yaml").write_text("default_config:\n")
    (d / "automations.yaml").write_text("[]")
    (d / "secrets.yaml").write_text("ha_token: x\n")
    # Allowlisted directory
    (d / "themes").mkdir()
    (d / "themes" / "dark.yaml").write_text("dark:\n  primary: black\n")
    # NOT allowlisted top-level file
    (d / "home-assistant.log").write_text("noisy log lines")
    (d / ".HA_VERSION").write_text("2026.5.0")
    # NOT allowlisted directory
    (d / "deps").mkdir()
    (d / "deps" / "cache.txt").write_text("regenerable junk")
    # .storage/ allowlisted + not
    storage = d / ".storage"
    storage.mkdir()
    (storage / "core.config_entries").write_text("{}")
    (storage / "core.device_registry").write_text("{}")
    (storage / "core.zigbee_network_backup_2026-05-27-02-15-00.json").write_text(
        '{"network_key":"abcd"}'
    )
    (storage / "person.user").write_text("{}")
    (storage / "lovelace").write_text("{}")
    (storage / "zha").write_text('{"network_settings": {"channel": 15}}')
    # NOT allowlisted in .storage/
    (storage / "diagnostics.cache").write_text("trash")
    (storage / "trace.saved_traces").write_text("trash")
    return d


@pytest.fixture
def ziggy_dirs(tmp_path):
    user_files = tmp_path / "user_files"
    user_files.mkdir()
    (user_files / "auth.db").write_bytes(b"\x00\x01\x02fake-sqlite")
    (user_files / "ir_devices.json").write_text("[]")
    config = tmp_path / "config"
    config.mkdir()
    (config / "settings.yaml").write_text("home:\n  id: home-1\n")
    (config / "ziggy_memory.yaml").write_text("pets: []\n")
    return user_files, config


@pytest.fixture
def mock_storage():
    m = MagicMock()
    m.bucket = "ziggy-backups-prod"
    m.list_prefix.return_value = []
    return m


@pytest.fixture
def ctx(ha_dir, ziggy_dirs, mock_storage, data_key):
    user_files, config = ziggy_dirs
    return be.BackupContext(
        home_id="home-1",
        device_id="dev-1",
        coordinator_type="smlight",
        data_key=data_key,
        ha_config_dir=ha_dir,
        user_files_dir=user_files,
        config_dir=config,
        storage=mock_storage,
        ha_url="http://ha.local:8123",
        ha_token="ha-token",
        today=dt.date(2026, 5, 27),
        coordinator_ieee="00:12:4b:00:11:22:33:44",
        ha_version="2026.5.0",
        ziggy_version="0.1.0-test",
        # Stub out the side effects so pre-flight and ZHA work in tests:
        _ntp_skew_provider=lambda: 0.0,
        _ha_post=lambda url, tok, dom, svc, payload: 200,
        _now=lambda: dt.datetime(2026, 5, 27, 2, 15, 30),
    )


# ---------- allowlist (_collect_ha_config) ----------

def _tar_names(blob: bytes) -> list[str]:
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        return sorted(tar.getnames())


def test_collect_ha_config_includes_allowlisted_files(ctx):
    blob, included = be._collect_ha_config(ctx)
    names = _tar_names(blob)
    assert "configuration.yaml" in names
    assert "automations.yaml" in names
    assert "secrets.yaml" in names


def test_collect_ha_config_includes_allowlisted_dirs(ctx):
    blob, _ = be._collect_ha_config(ctx)
    names = _tar_names(blob)
    # Directory itself + contents:
    assert "themes" in names
    assert "themes/dark.yaml" in names


def test_collect_ha_config_excludes_non_allowlisted_top_level(ctx):
    blob, _ = be._collect_ha_config(ctx)
    names = _tar_names(blob)
    assert "home-assistant.log" not in names
    assert ".HA_VERSION" not in names
    assert "deps" not in names
    assert "deps/cache.txt" not in names


def test_collect_ha_config_storage_allowlist(ctx):
    blob, _ = be._collect_ha_config(ctx)
    names = _tar_names(blob)
    # Allowed:
    assert ".storage/core.config_entries" in names
    assert ".storage/core.device_registry" in names
    assert ".storage/core.zigbee_network_backup_2026-05-27-02-15-00.json" in names
    assert ".storage/person.user" in names
    assert ".storage/lovelace" in names
    assert ".storage/zha" in names
    # Denied:
    assert ".storage/diagnostics.cache" not in names
    assert ".storage/trace.saved_traces" not in names


def test_collect_ha_config_returns_included_list(ctx):
    _, included = be._collect_ha_config(ctx)
    assert "configuration.yaml" in included
    assert "themes/" in included
    assert ".storage/core.config_entries" in included
    assert "deps/" not in included


def test_collect_ha_config_missing_ha_dir_raises(ctx):
    ctx.ha_config_dir = Path("/nonexistent/path")
    with pytest.raises(RuntimeError, match="ha_config_dir"):
        be._collect_ha_config(ctx)


# ---------- ziggy state ----------

def test_collect_ziggy_state_bundles_both_dirs(ctx):
    blob = be._collect_ziggy_state(ctx)
    names = _tar_names(blob)
    assert "user_files/auth.db" in names
    assert "user_files/ir_devices.json" in names
    assert "config/settings.yaml" in names
    assert "config/ziggy_memory.yaml" in names


# ---------- recorder DB ----------

def test_collect_recorder_db_absent_returns_none(ctx):
    out, skipped = be._collect_recorder_db(ctx)
    assert out is None and skipped is False


def test_collect_recorder_db_oversized_skipped(ctx, ha_dir):
    # Create a fake recorder.db larger than threshold.
    ctx.recorder_skip_threshold_mb = 1
    rec = ha_dir / be.RECORDER_FILENAME
    rec.write_bytes(b"x" * (2 * 1024 * 1024))  # 2 MB > 1 MB
    out, skipped = be._collect_recorder_db(ctx)
    assert out is None and skipped is True


def test_collect_recorder_db_under_threshold_snapshots(ctx, ha_dir, tmp_path):
    # Build a real tiny SQLite DB so the .backup() call succeeds.
    import sqlite3
    rec = ha_dir / be.RECORDER_FILENAME
    conn = sqlite3.connect(str(rec))
    conn.execute("CREATE TABLE t (x INTEGER)")
    conn.execute("INSERT INTO t VALUES (1)")
    conn.commit()
    conn.close()
    out, skipped = be._collect_recorder_db(ctx)
    assert skipped is False
    assert out is not None and len(out) > 0
    # Snapshot is a valid SQLite file — magic header bytes.
    assert out[:16].startswith(b"SQLite format 3\x00")


# ---------- ZHA trigger ----------

def test_trigger_zha_backup_returns_fresh_file(ctx):
    blob, src = be._trigger_and_read_zha_backup(ctx)
    assert b"network_key" in blob
    assert "zigbee_network_backup" in src.name


def test_trigger_zha_backup_non_2xx_raises(ctx):
    ctx._ha_post = lambda *a, **k: 500
    with pytest.raises(RuntimeError, match="HTTP 500"):
        be._trigger_and_read_zha_backup(ctx)


def test_trigger_zha_backup_stale_file_raises(ctx, ha_dir):
    import os
    # Set the existing fixture file's mtime to 10 min ago.
    storage_file = next((ha_dir / ".storage").glob("core.zigbee_network_backup*"))
    old = (ctx._now() - dt.timedelta(minutes=10)).timestamp()
    os.utime(storage_file, (old, old))
    with pytest.raises(RuntimeError, match="older than 5-minute"):
        be._trigger_and_read_zha_backup(ctx)


def test_trigger_zha_backup_no_file_raises(ctx, ha_dir):
    # Wipe the existing backup file.
    for p in (ha_dir / ".storage").glob("core.zigbee_network_backup*"):
        p.unlink()
    with pytest.raises(RuntimeError, match="did not produce"):
        be._trigger_and_read_zha_backup(ctx)


# ---------- NTP ----------

def test_ntp_check_skew_ok_passes(ctx):
    ctx._ntp_skew_provider = lambda: 5.0
    be._check_ntp_sync(ctx)  # no raise


def test_ntp_check_skew_too_large_raises(ctx):
    ctx._ntp_skew_provider = lambda: 75.0
    with pytest.raises(RuntimeError, match="Clock skew"):
        be._check_ntp_sync(ctx)


def test_ntp_check_no_source_raises(ctx):
    ctx._ntp_skew_provider = lambda: None
    with pytest.raises(RuntimeError, match="NTP sync source unavailable"):
        be._check_ntp_sync(ctx)


def test_ntp_check_negative_skew_within_tolerance_passes(ctx):
    ctx._ntp_skew_provider = lambda: -30.0
    be._check_ntp_sync(ctx)


def test_query_chrony_skew_parses_slow():
    # Exercise the chrony parser via a fake subprocess. Verify the slow/fast
    # sign handling and numeric extraction.
    from unittest.mock import patch
    fake = MagicMock(returncode=0, stdout=(
        "Reference ID    : 91.189.94.4 (...)\n"
        "Stratum         : 2\n"
        "System time     : 0.000123456 seconds slow of NTP time\n"
    ))
    with patch("services.backup_engine.subprocess.run", return_value=fake):
        skew = be._query_chrony_skew()
    assert skew == pytest.approx(-0.000123456)


def test_query_chrony_skew_parses_fast():
    from unittest.mock import patch
    fake = MagicMock(returncode=0, stdout=("System time     : 2.5 seconds fast of NTP time\n"))
    with patch("services.backup_engine.subprocess.run", return_value=fake):
        skew = be._query_chrony_skew()
    assert skew == pytest.approx(2.5)


def test_query_chrony_skew_no_binary_returns_none():
    from unittest.mock import patch
    with patch("services.backup_engine.subprocess.run", side_effect=FileNotFoundError):
        assert be._query_chrony_skew() is None


def test_query_timesyncd_synced_returns_zero():
    from unittest.mock import patch
    fake = MagicMock(returncode=0, stdout=("System clock synchronized: yes\n"))
    with patch("services.backup_engine.subprocess.run", return_value=fake):
        assert be._query_timesyncd_skew() == 0.0


def test_query_timesyncd_not_synced_returns_none():
    from unittest.mock import patch
    fake = MagicMock(returncode=0, stdout=("System clock synchronized: no\n"))
    with patch("services.backup_engine.subprocess.run", return_value=fake):
        assert be._query_timesyncd_skew() is None


# ---------- manifest ----------

def test_build_manifest_shape(ctx):
    encrypted = {
        "ha-config.tar.gz.enc": {
            "nonce": b"x" * 12, "ciphertext": b"y" * 100, "tag": b"z" * 16,
            "sha256_plaintext": "deadbeef", "size_plaintext": 50,
        },
        "ziggy-state.tar.gz.enc": {
            "nonce": b"a" * 12, "ciphertext": b"b" * 200, "tag": b"c" * 16,
            "sha256_plaintext": "cafebabe", "size_plaintext": 80,
        },
    }
    manifest = be._build_manifest(ctx, encrypted=encrypted, optional_skipped=[])
    data = json.loads(manifest)
    assert data["schema_version"] == 1
    assert data["home_id"] == "home-1"
    assert data["device_id"] == "dev-1"
    assert data["coordinator_type"] == "smlight"
    assert data["coordinator_ieee"] == "00:12:4b:00:11:22:33:44"
    assert data["created_at"] == "2026-05-27T02:15:30Z"
    names = [f["name"] for f in data["files"]]
    # Files are sorted in the manifest:
    assert names == sorted(names)
    assert "ha-config.tar.gz.enc" in names
    assert "ziggy-state.tar.gz.enc" in names


def test_build_manifest_includes_optional_skipped(ctx):
    manifest = be._build_manifest(ctx, encrypted={}, optional_skipped=["recorder.db"])
    data = json.loads(manifest)
    assert data["optional_skipped"] == ["recorder.db"]


def test_manifest_hmac_sign_verify_roundtrip(data_key):
    msg = b'{"schema_version":1,"home_id":"x"}'
    sig = be.sign_manifest(msg, data_key)
    assert be.verify_manifest_signature(msg, sig, data_key) is True


def test_manifest_hmac_wrong_key_fails(data_key):
    msg = b'{"x":1}'
    sig = be.sign_manifest(msg, data_key)
    other = bytes.fromhex("cc" * 32)
    assert be.verify_manifest_signature(msg, sig, other) is False


def test_manifest_hmac_tamper_fails(data_key):
    msg = b'{"x":1}'
    sig = be.sign_manifest(msg, data_key)
    assert be.verify_manifest_signature(b'{"x":2}', sig, data_key) is False


def test_manifest_hmac_key_differs_from_file_keys(data_key):
    # The manifest HMAC subkey must NOT collide with any per-file HKDF
    # subkey (different HKDF info string).
    manifest_key = be._manifest_hmac_key(data_key)
    file_key = backup_keys.derive_file_key(data_key, "manifest.json.enc")
    assert manifest_key != file_key


def test_parse_manifest_accepts_v1():
    plain = json.dumps({"schema_version": 1, "home_id": "x"}).encode()
    parsed = be.parse_manifest(plain)
    assert parsed["home_id"] == "x"


def test_parse_manifest_rejects_future_version():
    plain = json.dumps({"schema_version": 99}).encode()
    with pytest.raises(ValueError, match="agent too old"):
        be.parse_manifest(plain)


def test_parse_manifest_missing_schema_version():
    plain = json.dumps({"home_id": "x"}).encode()
    with pytest.raises(ValueError, match="missing schema_version"):
        be.parse_manifest(plain)


def test_parse_manifest_malformed_json():
    with pytest.raises(ValueError, match="malformed"):
        be.parse_manifest(b"{not-json")


# ---------- _encrypt_manifest ----------

def test_encrypt_manifest_decryptable_with_signature(ctx):
    plain = b'{"schema_version":1,"home_id":"home-1"}'
    enc = be._encrypt_manifest(ctx, plain)
    # Restore-side: derive same key, decrypt, verify HMAC.
    fk = backup_keys.derive_file_key(ctx.data_key, "manifest.json.enc")
    pt_signed = backup_keys.decrypt_file(enc["nonce"], enc["ciphertext"], enc["tag"], fk)
    bundle = json.loads(pt_signed)
    import base64
    manifest_bytes = base64.b64decode(bundle["manifest"])
    signature = base64.b64decode(bundle["hmac"])
    assert manifest_bytes == plain
    assert be.verify_manifest_signature(manifest_bytes, signature, ctx.data_key)


# ---------- end-to-end orchestration ----------

def test_run_daily_backup_happy_path(ctx, mock_storage):
    """Full pass — pre-flight stubbed, HA stubbed, storage mocked.

    Asserts result.ok, the right B2 keys were written, and the latest/
    promotion happened.
    """
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True, res
    assert res["stage"] == "done"
    assert res["uploaded_bytes"] > 0
    assert "ha-config.tar.gz.enc" in res["files"]
    assert "ziggy-state.tar.gz.enc" in res["files"]
    assert "zha-network-backup.json.enc" in res["files"]
    assert "manifest.json.enc" in res["files"]

    # Upload keys should be {home_id}/daily/{today}/...
    upload_keys = {call.args[1] for call in mock_storage.upload.call_args_list}
    expected_prefix = "home-1/daily/2026-05-27/"
    assert all(k.startswith(expected_prefix) for k in upload_keys)
    assert f"{expected_prefix}manifest.json.enc" in upload_keys

    # Promotion: server-side copy daily/ → latest/
    copy_calls = mock_storage.copy.call_args_list
    assert len(copy_calls) == len(res["files"])
    for call in copy_calls:
        src, dst = call.args
        assert src.startswith("home-1/daily/2026-05-27/")
        assert dst.startswith("home-1/latest/")


def test_run_daily_backup_preflight_failure_aborts(ctx):
    ctx._ntp_skew_provider = lambda: 500.0
    res = be.run_daily_backup(ctx)
    assert res["ok"] is False
    assert res["stage"] == "preflight"
    assert "Clock skew" in res["error"]


def test_run_daily_backup_zha_failure_aborts(ctx):
    ctx._ha_post = lambda *a, **k: 500
    res = be.run_daily_backup(ctx)
    assert res["ok"] is False
    assert res["stage"] == "zha"
    assert "HTTP 500" in res["error"]


def test_run_daily_backup_dry_run_skips_upload(ctx, mock_storage):
    ctx.dry_run = True
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True
    assert res["uploaded_bytes"] > 0  # computed sizes
    mock_storage.upload.assert_not_called()
    mock_storage.copy.assert_not_called()


def test_run_daily_backup_b2_unreachable_aborts(ctx, mock_storage):
    mock_storage.list_prefix.side_effect = RuntimeError("network down")
    res = be.run_daily_backup(ctx)
    assert res["ok"] is False
    assert res["stage"] == "preflight"
    assert "B2 unreachable" in res["error"]


def test_run_daily_backup_records_optional_skipped(ctx, ha_dir):
    # Force a recorder.db that's oversized so it gets skipped.
    ctx.recorder_skip_threshold_mb = 1
    (ha_dir / be.RECORDER_FILENAME).write_bytes(b"x" * (2 * 1024 * 1024))
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True
    assert "recorder.db" in res["optional_skipped"]


# ---------- restore-side reachability ----------

def test_full_roundtrip_through_manifest(ctx):
    """End-to-end: encrypt + manifest, then decrypt + verify on the other side.

    Simulates the restore script's path: download bundle bytes, decrypt
    each per the manifest, verify manifest HMAC.
    """
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True

    # Reconstruct the manifest from what was uploaded.
    uploaded = {call.args[1]: call.args[0] for call in ctx.storage.upload.call_args_list}
    manifest_blob = uploaded[f"home-1/daily/2026-05-27/manifest.json.enc"]
    nonce, ct_with_tag = manifest_blob[:12], manifest_blob[12:]
    fk = backup_keys.derive_file_key(ctx.data_key, "manifest.json.enc")
    ct, tag = ct_with_tag[:-16], ct_with_tag[-16:]
    pt = backup_keys.decrypt_file(nonce, ct, tag, fk)
    bundle = json.loads(pt)

    import base64
    manifest = json.loads(base64.b64decode(bundle["manifest"]))
    sig = base64.b64decode(bundle["hmac"])

    # Verify HMAC.
    raw_manifest = base64.b64decode(bundle["manifest"])
    assert be.verify_manifest_signature(raw_manifest, sig, ctx.data_key)

    # Verify each file decrypts cleanly per its manifest entry.
    for entry in manifest["files"]:
        name = entry["name"]
        blob = uploaded[f"home-1/daily/2026-05-27/{name}"]
        n, ct_full = blob[:12], blob[12:]
        ct, tag = ct_full[:-16], ct_full[-16:]
        fk_i = backup_keys.derive_file_key(ctx.data_key, name)
        plaintext = backup_keys.decrypt_file(n, ct, tag, fk_i)
        # sha256 in manifest matches the plaintext we just decrypted.
        import hashlib
        assert hashlib.sha256(plaintext).hexdigest() == entry["sha256_plaintext"]
        assert len(plaintext) == entry["size_plaintext"]
