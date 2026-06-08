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


# ---------- Chunk #5: lock with stale-PID cleanup ----------

import os as _os  # noqa: E402 — separated so it's clear these are Chunk #5 imports
import fcntl as _fcntl_test  # noqa: E402 — direct fcntl for the test-side held lock


def test_lock_acquire_release_happy(tmp_path):
    lock = str(tmp_path / "test.lock")
    fd = be._acquire_backup_lock(lock)
    assert fd is not None
    assert Path(lock).exists()
    assert int(Path(lock).read_text().strip()) == _os.getpid()
    be._release_backup_lock(fd, lock)
    assert not Path(lock).exists()


def test_lock_release_idempotent(tmp_path):
    lock = str(tmp_path / "test.lock")
    fd = be._acquire_backup_lock(lock)
    be._release_backup_lock(fd, lock)
    # Calling again with None is a no-op:
    be._release_backup_lock(None, lock)


def test_lock_stale_pid_cleared(tmp_path):
    """A lockfile holding a dead PID is silently cleared on acquire."""
    lock = tmp_path / "test.lock"
    # PID 99999999 is well above any plausible OS max_pid — guaranteed gone.
    lock.write_text("99999999\n")
    fd = be._acquire_backup_lock(str(lock))
    assert fd is not None
    assert int(lock.read_text().strip()) == _os.getpid()
    be._release_backup_lock(fd, str(lock))


def test_lock_corrupt_contents_cleared(tmp_path):
    lock = tmp_path / "test.lock"
    lock.write_text("definitely-not-a-pid\n")
    fd = be._acquire_backup_lock(str(lock))
    assert fd is not None
    be._release_backup_lock(fd, str(lock))


def test_lock_contention_raises(tmp_path):
    """A live flock held by another fd blocks acquisition."""
    lock = str(tmp_path / "test.lock")
    held_fd = _os.open(lock, _os.O_CREAT | _os.O_RDWR, 0o644)
    _fcntl_test.flock(held_fd, _fcntl_test.LOCK_EX | _fcntl_test.LOCK_NB)
    try:
        with pytest.raises(RuntimeError, match="already running"):
            be._acquire_backup_lock(lock)
    finally:
        _fcntl_test.flock(held_fd, _fcntl_test.LOCK_UN)
        _os.close(held_fd)


def test_pid_alive_self_is_true():
    assert be._pid_alive(_os.getpid()) is True


def test_pid_alive_dead_is_false():
    assert be._pid_alive(99999999) is False


def test_pid_alive_bad_pid_is_false():
    assert be._pid_alive(0) is False
    assert be._pid_alive(-1) is False


# ---------- Chunk #5: run_daily_backup_with_lock ----------

def test_with_lock_happy_path(ctx, tmp_path):
    ctx.lock_path = str(tmp_path / "test.lock")
    result = be.run_daily_backup_with_lock(ctx)
    assert result["ok"] is True, result
    # Lock file released after the run.
    assert not Path(ctx.lock_path).exists()


def test_with_lock_contention_returns_lock_stage(ctx, tmp_path):
    lock = str(tmp_path / "test.lock")
    ctx.lock_path = lock
    held_fd = _os.open(lock, _os.O_CREAT | _os.O_RDWR, 0o644)
    _fcntl_test.flock(held_fd, _fcntl_test.LOCK_EX | _fcntl_test.LOCK_NB)
    try:
        result = be.run_daily_backup_with_lock(ctx)
        assert result["ok"] is False
        assert result["stage"] == "lock"
        assert "already running" in result["error"]
        # Storage should not have been touched.
        ctx.storage.upload.assert_not_called()
    finally:
        _fcntl_test.flock(held_fd, _fcntl_test.LOCK_UN)
        _os.close(held_fd)


def test_with_lock_releases_on_inner_failure(ctx, tmp_path):
    """Even when run_daily_backup returns a failure dict, the lock is released."""
    ctx.lock_path = str(tmp_path / "test.lock")
    ctx._ntp_skew_provider = lambda: 999.0  # force pre-flight failure
    result = be.run_daily_backup_with_lock(ctx)
    assert result["ok"] is False
    assert result["stage"] == "preflight"
    assert not Path(ctx.lock_path).exists()


# ---------- Chunk #5: BackupContext.from_settings ----------

def _good_settings(tmp_path, kit_manifest_path=None):
    """Settings dict + on-disk data_key file. Returns (settings, data_key_path)."""
    dkp = tmp_path / "data_key"
    dkp.write_bytes(b"x" * 32)
    if kit_manifest_path is None:
        kit_manifest_path = str(tmp_path / "nonexistent_kit.yaml")
    return {
        "home": {"id": "home-test"},
        "home_assistant": {"url": "http://ha.local", "token": "tok"},
        "backup": {
            "b2_endpoint": "https://s3.eu-central-003.backblazeb2.com",
            "b2_bucket": "test-bucket",
            "b2_key_id_env": "TEST_B2_KEY",
            "b2_app_key_env": "TEST_B2_APP",
            "data_key_path": str(dkp),
            "kit_manifest_path": kit_manifest_path,
            "device_id": "dev-test",
            "coordinator_type": "smlight",
            "ha_config_dir": str(tmp_path / "ha"),
            "user_files_dir": str(tmp_path / "uf"),
            "config_dir": str(tmp_path / "cfg"),
            "lock_path": str(tmp_path / "lock"),
            "recorder_skip_threshold_mb": 250,
        },
    }, dkp


@pytest.fixture
def _b2_env(monkeypatch):
    monkeypatch.setenv("TEST_B2_KEY", "k")
    monkeypatch.setenv("TEST_B2_APP", "a")


def test_from_settings_happy_path(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    ctx = be.BackupContext.from_settings(settings)
    assert ctx.home_id == "home-test"
    assert ctx.device_id == "dev-test"
    assert ctx.coordinator_type == "smlight"
    assert ctx.coordinator_ieee is None
    assert len(ctx.data_key) == 32
    assert ctx.ha_config_dir == Path(str(tmp_path / "ha"))
    assert ctx.recorder_skip_threshold_mb == 250


def test_from_settings_kit_manifest_overrides_fallbacks(tmp_path, _b2_env):
    kit = tmp_path / "kit.yaml"
    kit.write_text(
        "device_id: kit-dev-id\n"
        "coordinator_type: sonoff_e\n"
        "coordinator_ieee: \"00:11:22:33:44:55:66:77\"\n"
    )
    settings, _ = _good_settings(tmp_path, kit_manifest_path=str(kit))
    settings["backup"]["device_id"] = "REPLACE_WITH_DEVICE_ID"  # ignored
    settings["backup"]["coordinator_type"] = "smlight"  # ignored
    ctx = be.BackupContext.from_settings(settings)
    assert ctx.device_id == "kit-dev-id"
    assert ctx.coordinator_type == "sonoff_e"
    assert ctx.coordinator_ieee == "00:11:22:33:44:55:66:77"


def test_from_settings_missing_home_id_raises(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    settings["home"]["id"] = ""
    with pytest.raises(RuntimeError, match="home.id"):
        be.BackupContext.from_settings(settings)


def test_from_settings_placeholder_device_id_raises(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    settings["backup"]["device_id"] = "REPLACE_WITH_DEVICE_ID"
    with pytest.raises(RuntimeError, match="device_id missing"):
        be.BackupContext.from_settings(settings)


def test_from_settings_unknown_coordinator_raises(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    settings["backup"]["coordinator_type"] = "huawei"
    with pytest.raises(RuntimeError, match="coordinator_type"):
        be.BackupContext.from_settings(settings)


def test_from_settings_missing_ha_url_raises(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    settings["home_assistant"]["url"] = ""
    with pytest.raises(RuntimeError, match="home_assistant"):
        be.BackupContext.from_settings(settings)


def test_from_settings_propagates_dry_run(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    ctx = be.BackupContext.from_settings(settings, dry_run=True)
    assert ctx.dry_run is True


# ---------- Chunk #5: data_key + kit_manifest helpers ----------

def test_load_data_key_wrong_size(tmp_path):
    p = tmp_path / "key"
    p.write_bytes(b"x" * 16)
    with pytest.raises(RuntimeError, match="32 bytes"):
        be._load_data_key(str(p))


def test_load_data_key_missing_file(tmp_path):
    with pytest.raises(RuntimeError, match="not found"):
        be._load_data_key(str(tmp_path / "absent"))


def test_load_data_key_happy(tmp_path):
    p = tmp_path / "key"
    p.write_bytes(b"x" * 32)
    assert be._load_data_key(str(p)) == b"x" * 32


def test_read_kit_manifest_absent_returns_empty(tmp_path):
    assert be._read_kit_manifest(str(tmp_path / "absent")) == {}


def test_read_kit_manifest_parses_yaml(tmp_path):
    p = tmp_path / "kit.yaml"
    p.write_text("device_id: x\ncoordinator_type: smlight\n")
    assert be._read_kit_manifest(str(p)) == {
        "device_id": "x", "coordinator_type": "smlight",
    }


def test_read_kit_manifest_bad_yaml_returns_empty(tmp_path):
    p = tmp_path / "kit.yaml"
    p.write_text("[: not yaml :{")
    assert be._read_kit_manifest(str(p)) == {}


def test_read_kit_manifest_non_dict_returns_empty(tmp_path):
    p = tmp_path / "kit.yaml"
    p.write_text("- just\n- a\n- list\n")
    assert be._read_kit_manifest(str(p)) == {}


# ---------- Chunk #5: CLI (python -m services.backup_engine) ----------

def test_cli_requires_once_flag(capsys):
    with pytest.raises(SystemExit):
        be._main([])


def test_cli_runs_with_once(monkeypatch, capsys, ctx, tmp_path):
    """Stub the context builder so the CLI sees our pre-wired test ctx."""
    ctx.lock_path = str(tmp_path / "test.lock")
    monkeypatch.setattr(be, "_build_context_from_settings",
                        lambda *a, **kw: ctx)
    code = be._main(["--once"])
    assert code == 0
    out = capsys.readouterr().out
    assert '"ok": true' in out.lower() or '"ok": True' in out


def test_cli_dry_run_propagates(monkeypatch, capsys, ctx, tmp_path):
    ctx.lock_path = str(tmp_path / "test.lock")
    captured: dict = {}

    def _fake_builder(settings, *, dry_run, today):
        captured["dry_run"] = dry_run
        ctx.dry_run = dry_run
        return ctx

    monkeypatch.setattr(be, "_build_context_from_settings", _fake_builder)
    code = be._main(["--once", "--dry-run"])
    assert code == 0
    assert captured["dry_run"] is True
    # In dry-run, no actual upload calls.
    ctx.storage.upload.assert_not_called()


def test_cli_failure_returns_nonzero(monkeypatch, capsys, ctx, tmp_path):
    ctx.lock_path = str(tmp_path / "test.lock")
    ctx._ntp_skew_provider = lambda: 999.0  # force pre-flight failure
    monkeypatch.setattr(be, "_build_context_from_settings",
                        lambda *a, **kw: ctx)
    code = be._main(["--once"])
    assert code == 1


# ---------- relay status POST ----------
#
# Coverage for _report_status_to_relay: the hub posts the run outcome
# (success OR failure) to the relay so the founder GET sees an audit
# trail. The POST is signed with the per-home relay_secret and must not
# crash the backup if the relay is unreachable.


def _wire_relay(ctx, posted: list, status: int = 200):
    """Attach mock relay config + a capturing _relay_post hook to ctx.

    The hook appends (url, headers, body) to `posted` so tests can assert
    what the engine tried to send.
    """
    ctx.relay_url = "https://ziggy-relay.fly.dev"
    ctx.relay_secret = "test-secret"

    def _fake_post(url, headers, body, timeout):
        posted.append({"url": url, "headers": headers, "body": body, "timeout": timeout})
        return status

    ctx._relay_post = _fake_post


def test_relay_status_post_fires_on_success(ctx, mock_storage):
    posted: list = []
    _wire_relay(ctx, posted)
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True
    assert len(posted) == 1
    call = posted[0]
    assert call["url"] == "https://ziggy-relay.fly.dev/api/homes/home-1/backup-status"
    assert "X-Ziggy-Signature" in call["headers"]
    body = json.loads(call["body"])
    assert body["outcome"] == "success"
    assert body["stage"] == "done"
    assert body["uploaded_bytes"] > 0
    assert body["error_reason"] is None
    assert body["skipped_reason"] is None
    assert body["dry_run"] is False
    assert "ha-config.tar.gz.enc" in body["files"]


def test_relay_status_post_fires_on_failure(ctx):
    """Pre-flight failure still produces a status POST with outcome=failure."""
    posted: list = []
    _wire_relay(ctx, posted)
    ctx._ntp_skew_provider = lambda: 999.0  # force pre-flight failure
    res = be.run_daily_backup(ctx)
    assert res["ok"] is False
    assert res["stage"] == "preflight"
    assert len(posted) == 1
    body = json.loads(posted[0]["body"])
    assert body["outcome"] == "failure"
    assert body["stage"] == "preflight"
    assert "Clock skew" in body["error_reason"]


def test_relay_status_post_failure_does_not_crash_backup(ctx, mock_storage):
    """Relay round-trip failure must NOT poison a successful backup."""
    posted: list = []

    def _broken_post(url, headers, body, timeout):
        posted.append(body)
        raise RuntimeError("simulated relay network outage")

    ctx.relay_url = "https://ziggy-relay.fly.dev"
    ctx.relay_secret = "test-secret"
    ctx._relay_post = _broken_post

    res = be.run_daily_backup(ctx)
    # The backup itself still succeeded — uploaded bytes, files in result.
    assert res["ok"] is True, res
    assert res["stage"] == "done"
    assert res["uploaded_bytes"] > 0
    # The POST was attempted (proves we entered the reporter) and the
    # raise propagated up to the swallowing try/except in run_daily_backup.
    assert len(posted) == 1


def test_relay_status_post_skipped_when_creds_missing(ctx, mock_storage):
    """No relay_url/relay_secret => no POST attempted, no log noise."""
    posted: list = []
    # Hook is set but should never be invoked because creds are absent.
    ctx._relay_post = lambda *a, **k: posted.append(a) or 200
    # Explicitly leave relay_url/relay_secret as None (default).
    assert ctx.relay_url is None
    assert ctx.relay_secret is None
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True
    assert posted == []


def test_relay_status_post_non_2xx_logged_but_swallowed(ctx, mock_storage, caplog):
    """Relay returning 500 is a warning, not a crash."""
    import logging
    posted: list = []
    _wire_relay(ctx, posted, status=500)
    with caplog.at_level(logging.WARNING, logger="services.backup_engine"):
        res = be.run_daily_backup(ctx)
    assert res["ok"] is True
    assert len(posted) == 1
    assert any("HTTP 500" in rec.message or "backup-status" in rec.message
               for rec in caplog.records)


def test_relay_status_post_signature_verifies(ctx, mock_storage):
    """Signed body must validate with the same HMAC the relay uses."""
    import hashlib
    import hmac as _hmac
    posted: list = []
    _wire_relay(ctx, posted)
    res = be.run_daily_backup(ctx)
    assert res["ok"] is True
    call = posted[0]
    sig_header = call["headers"]["X-Ziggy-Signature"]
    assert sig_header.startswith("t=") and ",v1=" in sig_header
    ts_part, v1_part = sig_header.split(",")
    ts = ts_part[len("t="):]
    v1 = v1_part[len("v1="):]
    expected = _hmac.new(
        b"test-secret",
        f"{ts}.".encode() + call["body"],
        hashlib.sha256,
    ).hexdigest()
    assert _hmac.compare_digest(expected, v1)


def test_relay_status_post_skipped_outcome_on_subscription_gate(ctx, mock_storage, monkeypatch):
    """Subscription-gated skip reports outcome=skipped, not failure."""
    posted: list = []
    _wire_relay(ctx, posted)
    monkeypatch.setattr(
        "services.subscription_state.is_backup_allowed",
        lambda: False,
    )
    res = be.run_daily_backup(ctx)
    assert res["ok"] is False
    assert res["skipped_reason"] == "subscription_gated"
    assert len(posted) == 1
    body = json.loads(posted[0]["body"])
    assert body["outcome"] == "skipped"
    assert body["skipped_reason"] == "subscription_gated"
    assert body["error_reason"] is None


def test_from_settings_propagates_relay_config(tmp_path, _b2_env):
    settings, _ = _good_settings(tmp_path)
    settings["relay"] = {"url": "https://relay.example", "secret": "s3cr3t"}
    ctx = be.BackupContext.from_settings(settings)
    assert ctx.relay_url == "https://relay.example"
    assert ctx.relay_secret == "s3cr3t"


def test_from_settings_relay_missing_leaves_none(tmp_path, _b2_env):
    """Hubs without relay config get None — POST is silently skipped."""
    settings, _ = _good_settings(tmp_path)
    settings.pop("relay", None)
    ctx = be.BackupContext.from_settings(settings)
    assert ctx.relay_url is None
    assert ctx.relay_secret is None
