"""Tests for scripts/factory/restore_helper.py — Chunk #9 restore helper.

Coverage:
  decrypt-manifest: happy path (round-trip with Chunk #4 encryptor),
                    wrong data_key, tampered ciphertext, tampered HMAC,
                    future schema_version rejected, malformed envelope
  decrypt-file:     happy path (matches an engine-side encrypted file),
                    wrong data_key
  download-b2:      happy path with mocked boto3, missing creds
  verify-coordinator: match, mismatch+allow, mismatch+deny, kit missing
  write-keys:       atomic write, mode 0600, b64 validation, json validation

Plus a bash smoke test that the script exists, is executable, --help
works, and rejects invocations without an old_device_id.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Make the helper importable as a module for direct function-call tests.
_HELPER_DIR = Path(__file__).parent.parent / "scripts" / "factory"
sys.path.insert(0, str(_HELPER_DIR))
import restore_helper as rh  # noqa: E402

from services import backup_keys  # noqa: E402
from services.backup_engine import (  # noqa: E402
    BackupContext, SCHEMA_VERSION, run_daily_backup, sign_manifest,
)


# ---------- helpers ----------

def _data_key() -> bytes:
    return bytes.fromhex("bb" * 32)


def _build_manifest_blob(data_key: bytes) -> tuple[bytes, dict]:
    """Build a real encrypted manifest blob by running the engine end-to-end.

    Returns (encrypted_blob, parsed_manifest_dict) — what the restore
    helper would receive on stdin and what it should produce on stdout.
    """
    import datetime as dt
    import io
    import tarfile

    # Minimal ctx that lets the engine run end-to-end with mocked storage.
    tmp = tempfile.mkdtemp()
    ha_dir = Path(tmp) / "ha-config"
    ha_dir.mkdir()
    (ha_dir / "configuration.yaml").write_text("default_config:\n")
    storage_dir = ha_dir / ".storage"
    storage_dir.mkdir()
    (storage_dir / "core.zigbee_network_backup_2026-05-27.json").write_text(
        '{"network_key": "abcd"}'
    )

    user_files = Path(tmp) / "user_files"
    user_files.mkdir()
    (user_files / "auth.db").write_bytes(b"fake")

    config = Path(tmp) / "config"
    config.mkdir()
    (config / "settings.yaml").write_text("home:\n  id: home-1\n")

    storage = MagicMock()
    storage.list_prefix.return_value = []

    ctx = BackupContext(
        home_id="home-1", device_id="dev-1",
        coordinator_type="smlight", data_key=data_key,
        ha_config_dir=ha_dir, user_files_dir=user_files, config_dir=config,
        storage=storage, ha_url="http://h", ha_token="t",
        today=dt.date(2026, 5, 27),
        _ntp_skew_provider=lambda: 0.0,
        _ha_post=lambda *a, **k: 200,
        _now=lambda: dt.datetime(2026, 5, 27, 2, 0, 0),
    )
    result = run_daily_backup(ctx)
    assert result["ok"], result

    uploaded = {c.args[1]: c.args[0] for c in storage.upload.call_args_list}
    blob = uploaded["home-1/daily/2026-05-27/manifest.json.enc"]
    return blob, result


@pytest.fixture
def data_key_file(tmp_path):
    """A file containing the base64-encoded data_key."""
    p = tmp_path / "dk.b64"
    p.write_text(base64.b64encode(_data_key()).decode())
    return str(p)


@pytest.fixture
def manifest_blob():
    blob, _ = _build_manifest_blob(_data_key())
    return blob


# ---------- decrypt-manifest ----------

def test_decrypt_manifest_happy(monkeypatch, capsys, data_key_file, manifest_blob):
    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: manifest_blob)))
    args = MagicMock(data_key_file=data_key_file)
    rh.cmd_decrypt_manifest(args)
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["schema_version"] == 1
    assert parsed["home_id"] == "home-1"
    assert parsed["coordinator_type"] == "smlight"
    assert len(parsed["files"]) >= 3  # ha-config + ziggy-state + zha


def test_decrypt_manifest_wrong_key(monkeypatch, capsys, tmp_path, manifest_blob):
    wrong_key_file = tmp_path / "wrong.b64"
    wrong_key_file.write_text(base64.b64encode(b"X" * 32).decode())
    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: manifest_blob)))
    args = MagicMock(data_key_file=str(wrong_key_file))
    with pytest.raises(SystemExit) as exc:
        rh.cmd_decrypt_manifest(args)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "decryption failed" in err.lower()


def test_decrypt_manifest_tampered_ciphertext(monkeypatch, capsys, data_key_file, manifest_blob):
    tampered = bytearray(manifest_blob)
    # Flip a bit inside the ciphertext region (after the 12-byte nonce).
    tampered[20] ^= 0x01
    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: bytes(tampered))))
    args = MagicMock(data_key_file=data_key_file)
    with pytest.raises(SystemExit) as exc:
        rh.cmd_decrypt_manifest(args)
    assert exc.value.code == 1


def test_decrypt_manifest_tampered_hmac(monkeypatch, capsys, tmp_path, data_key_file):
    """Build a manifest blob whose outer GCM is OK but inner HMAC is wrong."""
    import datetime as dt
    dk = _data_key()
    inner_manifest = json.dumps({
        "schema_version": 1, "home_id": "x", "files": [],
    }).encode()
    bad_sig = b"\x00" * 32  # not the real HMAC
    signed = json.dumps({
        "manifest": base64.b64encode(inner_manifest).decode(),
        "hmac": base64.b64encode(bad_sig).decode(),
    }).encode()
    fk = backup_keys.derive_file_key(dk, "manifest.json.enc")
    nonce, ct, tag = backup_keys.encrypt_file(signed, fk)
    blob = nonce + ct + tag

    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: blob)))
    args = MagicMock(data_key_file=data_key_file)
    with pytest.raises(SystemExit) as exc:
        rh.cmd_decrypt_manifest(args)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "HMAC" in err


def test_decrypt_manifest_future_schema_version(monkeypatch, capsys, data_key_file):
    """schema_version > KNOWN must abort cleanly."""
    dk = _data_key()
    future_manifest = json.dumps({
        "schema_version": SCHEMA_VERSION + 5, "home_id": "x", "files": [],
    }).encode()
    sig = sign_manifest(future_manifest, dk)
    signed = json.dumps({
        "manifest": base64.b64encode(future_manifest).decode(),
        "hmac": base64.b64encode(sig).decode(),
    }).encode()
    fk = backup_keys.derive_file_key(dk, "manifest.json.enc")
    nonce, ct, tag = backup_keys.encrypt_file(signed, fk)
    blob = nonce + ct + tag

    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: blob)))
    args = MagicMock(data_key_file=data_key_file)
    with pytest.raises(SystemExit) as exc:
        rh.cmd_decrypt_manifest(args)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "schema" in err.lower()
    assert "agent too old" in err.lower()


def test_decrypt_manifest_too_short(monkeypatch, capsys, data_key_file):
    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: b"tiny")))
    args = MagicMock(data_key_file=data_key_file)
    with pytest.raises(SystemExit):
        rh.cmd_decrypt_manifest(args)
    assert "too short" in capsys.readouterr().err


# ---------- decrypt-file ----------

def test_decrypt_file_round_trip(monkeypatch, capsys, data_key_file, tmp_path):
    """A blob encrypted by backup_keys.encrypt_file decrypts cleanly here."""
    dk = _data_key()
    plaintext = b"hello, ziggy state tar.gz contents"
    fk = backup_keys.derive_file_key(dk, "ziggy-state.tar.gz.enc")
    nonce, ct, tag = backup_keys.encrypt_file(plaintext, fk)
    blob = nonce + ct + tag

    output = tmp_path / "out.bin"
    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: blob)))
    args = MagicMock(
        data_key_file=data_key_file,
        filename="ziggy-state.tar.gz.enc",
        output=str(output),
    )
    rh.cmd_decrypt_file(args)
    assert output.read_bytes() == plaintext


def test_decrypt_file_wrong_key(monkeypatch, capsys, tmp_path):
    dk = _data_key()
    fk = backup_keys.derive_file_key(dk, "x.enc")
    nonce, ct, tag = backup_keys.encrypt_file(b"plain", fk)
    blob = nonce + ct + tag

    wrong = tmp_path / "wrong.b64"
    wrong.write_text(base64.b64encode(b"X" * 32).decode())
    monkeypatch.setattr("sys.stdin", MagicMock(buffer=MagicMock(read=lambda: blob)))
    args = MagicMock(
        data_key_file=str(wrong), filename="x.enc",
        output=str(tmp_path / "out"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_decrypt_file(args)
    assert "decrypt failed" in capsys.readouterr().err


# ---------- download-b2 ----------

def test_download_b2_happy(tmp_path):
    """Mock boto3 client to return a known body."""
    out = tmp_path / "downloaded.bin"
    fake_client = MagicMock()
    body = MagicMock()
    body.read.return_value = b"hello b2"
    fake_client.get_object.return_value = {"Body": body}

    with patch("boto3.client", return_value=fake_client):
        args = MagicMock(
            b2_credentials_json='{"b2_key_id":"K","b2_app_key":"A"}',
            bucket="ziggy-backups-prod", key="home-x/latest/foo.enc",
            output=str(out),
        )
        rh.cmd_download_b2(args)
    assert out.read_bytes() == b"hello b2"
    fake_client.get_object.assert_called_once_with(
        Bucket="ziggy-backups-prod", Key="home-x/latest/foo.enc"
    )


def test_download_b2_missing_creds(capsys, tmp_path):
    args = MagicMock(
        b2_credentials_json='{"b2_key_id":""}',  # missing app_key
        bucket="b", key="k", output=str(tmp_path / "out"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_download_b2(args)
    assert "b2_key_id" in capsys.readouterr().err


def test_download_b2_invalid_json(capsys, tmp_path):
    args = MagicMock(
        b2_credentials_json="not-json",
        bucket="b", key="k", output=str(tmp_path / "out"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_download_b2(args)


# ---------- verify-coordinator ----------

def _kit(tmp_path, coordinator_type: str) -> str:
    p = tmp_path / "kit.yaml"
    p.write_text(f"device_id: dev-x\ncoordinator_type: {coordinator_type}\n")
    return str(p)


def test_verify_coordinator_match(tmp_path, capsys):
    args = MagicMock(kit_manifest=_kit(tmp_path, "smlight"),
                     manifest_coord="smlight", allow_switch=False, allow_missing=False)
    rh.cmd_verify_coordinator(args)
    assert "coordinator match" in capsys.readouterr().err


def test_verify_coordinator_mismatch_without_flag(tmp_path, capsys):
    args = MagicMock(kit_manifest=_kit(tmp_path, "sonoff_e"),
                     manifest_coord="smlight", allow_switch=False, allow_missing=False)
    with pytest.raises(SystemExit):
        rh.cmd_verify_coordinator(args)
    err = capsys.readouterr().err
    assert "coordinator mismatch" in err
    assert "allow-coordinator-switch" in err


def test_verify_coordinator_mismatch_with_allow_switch(tmp_path, capsys):
    args = MagicMock(kit_manifest=_kit(tmp_path, "sonoff_e"),
                     manifest_coord="smlight", allow_switch=True, allow_missing=False)
    rh.cmd_verify_coordinator(args)
    err = capsys.readouterr().err
    assert "WARNING" in err
    assert "coordinator switch" in err


def test_verify_coordinator_kit_missing_no_override(tmp_path, capsys):
    args = MagicMock(kit_manifest=str(tmp_path / "nope.yaml"),
                     manifest_coord="smlight", allow_switch=False, allow_missing=False)
    with pytest.raises(SystemExit):
        rh.cmd_verify_coordinator(args)
    assert "kit manifest not found" in capsys.readouterr().err


def test_verify_coordinator_kit_missing_with_allow(tmp_path, capsys):
    args = MagicMock(kit_manifest=str(tmp_path / "nope.yaml"),
                     manifest_coord="smlight", allow_switch=False, allow_missing=True)
    rh.cmd_verify_coordinator(args)
    assert "WARNING" in capsys.readouterr().err


def test_verify_coordinator_kit_missing_coordinator_field(tmp_path):
    p = tmp_path / "kit.yaml"
    p.write_text("device_id: x\n")  # no coordinator_type
    args = MagicMock(kit_manifest=str(p), manifest_coord="smlight",
                     allow_switch=False, allow_missing=False)
    with pytest.raises(SystemExit):
        rh.cmd_verify_coordinator(args)


# ---------- write-keys ----------

def test_write_keys_creates_files_with_mode_0600(tmp_path):
    data_key = b"D" * 32
    b2 = {"b2_key_id": "K005abc", "b2_app_key": "S", "b2_endpoint": "https://x"}
    dk_path = tmp_path / "etc" / "data_key"
    b2_path = tmp_path / "etc" / "b2_credentials"
    args = MagicMock(
        data_key_b64=base64.b64encode(data_key).decode(),
        b2_credentials_json=json.dumps(b2),
        data_key_path=str(dk_path),
        b2_credentials_path=str(b2_path),
    )
    rh.cmd_write_keys(args)
    assert dk_path.read_bytes() == data_key
    assert json.loads(b2_path.read_text()) == b2
    # mode bits (Unix)
    assert (dk_path.stat().st_mode & 0o777) == 0o600
    assert (b2_path.stat().st_mode & 0o777) == 0o600


def test_write_keys_rejects_bad_base64(tmp_path):
    args = MagicMock(
        data_key_b64="!!!not-base64!!!",
        b2_credentials_json='{}',
        data_key_path=str(tmp_path / "k"),
        b2_credentials_path=str(tmp_path / "b"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_write_keys(args)


def test_write_keys_rejects_wrong_size(tmp_path):
    args = MagicMock(
        data_key_b64=base64.b64encode(b"too-short").decode(),
        b2_credentials_json='{}',
        data_key_path=str(tmp_path / "k"),
        b2_credentials_path=str(tmp_path / "b"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_write_keys(args)


def test_write_keys_rejects_bad_json(tmp_path):
    args = MagicMock(
        data_key_b64=base64.b64encode(b"D" * 32).decode(),
        b2_credentials_json="not-json",
        data_key_path=str(tmp_path / "k"),
        b2_credentials_path=str(tmp_path / "b"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_write_keys(args)


def test_write_keys_rejects_non_object_json(tmp_path):
    args = MagicMock(
        data_key_b64=base64.b64encode(b"D" * 32).decode(),
        b2_credentials_json='["a","b"]',  # list, not object
        data_key_path=str(tmp_path / "k"),
        b2_credentials_path=str(tmp_path / "b"),
    )
    with pytest.raises(SystemExit):
        rh.cmd_write_keys(args)


# ---------- CLI dispatch ----------

def test_main_requires_subcommand(capsys):
    with pytest.raises(SystemExit):
        rh.main([])


def test_main_dispatches_unknown_subcommand(capsys):
    with pytest.raises(SystemExit):
        rh.main(["not-a-real-cmd"])


# ---------- bash script smoke tests ----------

_SCRIPT = Path(__file__).parent.parent / "scripts" / "factory" / "ziggy-restore-device.sh"


def test_bash_script_exists_and_executable():
    assert _SCRIPT.is_file()
    assert os.access(str(_SCRIPT), os.X_OK)


def test_bash_script_help():
    proc = subprocess.run([str(_SCRIPT), "--help"], capture_output=True, text=True)
    assert proc.returncode == 0
    assert "ziggy-restore-device.sh" in proc.stdout
    assert "DESIGN_BACKUP_DR.md" in proc.stdout


def test_bash_script_rejects_missing_device_id():
    proc = subprocess.run([str(_SCRIPT)], capture_output=True, text=True)
    assert proc.returncode == 2
    assert "old_device_id" in proc.stderr or "USAGE" in proc.stderr


def test_bash_script_rejects_unknown_flag():
    proc = subprocess.run([str(_SCRIPT), "--not-a-flag"], capture_output=True, text=True)
    assert proc.returncode == 2


def test_bash_script_syntax_clean():
    """`bash -n` parses the script without executing it."""
    proc = subprocess.run(["bash", "-n", str(_SCRIPT)], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
