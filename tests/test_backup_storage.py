"""Tests for services/backup_storage.py — B2 client wrapper.

All tests use unittest.mock.MagicMock to stand in for the boto3 client.
No live B2 hits — the wrapper is tested by inspecting the boto3 calls
it makes and the values it returns from canned responses.

Coverage:
  - upload          : passes bytes through; validates inputs
  - download        : returns body bytes; raises FileNotFoundError on miss;
                      re-raises non-NoSuchKey ClientErrors
  - list_prefix     : aggregates across paginated pages; empty result OK
  - copy            : issues server-side copy with the right CopySource shape
  - from_settings   : reads settings + env vars; raises on missing pieces
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from services.backup_storage import BackupStorage


# ---------- helpers ----------

def _make_storage(client: MagicMock | None = None, bucket: str = "test-bucket") -> tuple[BackupStorage, MagicMock]:
    """Build a BackupStorage bound to a MagicMock client. Returns both."""
    client = client or MagicMock()
    return BackupStorage(bucket=bucket, client=client), client


def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "GetObject")


# ---------- constructor ----------

def test_init_requires_bucket():
    with pytest.raises(ValueError, match="bucket"):
        BackupStorage(bucket="", client=MagicMock())


def test_init_requires_client():
    with pytest.raises(ValueError, match="client"):
        BackupStorage(bucket="b", client=None)  # type: ignore[arg-type]


def test_bucket_property():
    s, _ = _make_storage(bucket="ziggy-backups-prod")
    assert s.bucket == "ziggy-backups-prod"


# ---------- upload ----------

def test_upload_passes_bytes_through():
    s, c = _make_storage()
    s.upload(b"hello", "home-1/daily/2026-05-27/manifest.json.enc")
    c.put_object.assert_called_once_with(
        Bucket="test-bucket",
        Key="home-1/daily/2026-05-27/manifest.json.enc",
        Body=b"hello",
    )


def test_upload_accepts_bytearray():
    s, c = _make_storage()
    s.upload(bytearray(b"hi"), "k")
    # Coerced to bytes before send.
    sent = c.put_object.call_args.kwargs["Body"]
    assert sent == b"hi" and isinstance(sent, bytes)


def test_upload_rejects_non_bytes():
    s, _ = _make_storage()
    with pytest.raises(TypeError, match="data must be bytes"):
        s.upload("not bytes", "k")  # type: ignore[arg-type]


def test_upload_rejects_empty_key():
    s, _ = _make_storage()
    with pytest.raises(ValueError, match="key"):
        s.upload(b"data", "")


# ---------- download ----------

def test_download_returns_body_bytes():
    s, c = _make_storage()
    body = MagicMock()
    body.read.return_value = b"the bytes"
    c.get_object.return_value = {"Body": body}
    assert s.download("k") == b"the bytes"
    c.get_object.assert_called_once_with(Bucket="test-bucket", Key="k")


def test_download_missing_key_raises_filenotfound():
    s, c = _make_storage()
    c.get_object.side_effect = _client_error("NoSuchKey")
    with pytest.raises(FileNotFoundError, match="b2://test-bucket/missing"):
        s.download("missing")


def test_download_404_also_raises_filenotfound():
    # Some S3-compatible services return code "404" instead of "NoSuchKey".
    s, c = _make_storage()
    c.get_object.side_effect = _client_error("404")
    with pytest.raises(FileNotFoundError):
        s.download("missing")


def test_download_other_client_error_propagates():
    s, c = _make_storage()
    c.get_object.side_effect = _client_error("AccessDenied")
    with pytest.raises(ClientError):
        s.download("k")


def test_download_rejects_empty_key():
    s, _ = _make_storage()
    with pytest.raises(ValueError, match="key"):
        s.download("")


# ---------- list_prefix ----------

def test_list_prefix_single_page():
    s, c = _make_storage()
    paginator = MagicMock()
    paginator.paginate.return_value = [
        {"Contents": [{"Key": "home-1/daily/a.enc"}, {"Key": "home-1/daily/b.enc"}]},
    ]
    c.get_paginator.return_value = paginator
    assert s.list_prefix("home-1/daily/") == ["home-1/daily/a.enc", "home-1/daily/b.enc"]
    c.get_paginator.assert_called_once_with("list_objects_v2")
    paginator.paginate.assert_called_once_with(Bucket="test-bucket", Prefix="home-1/daily/")


def test_list_prefix_paginates():
    s, c = _make_storage()
    paginator = MagicMock()
    paginator.paginate.return_value = [
        {"Contents": [{"Key": "a"}, {"Key": "b"}]},
        {"Contents": [{"Key": "c"}]},
        {"Contents": [{"Key": "d"}, {"Key": "e"}]},
    ]
    c.get_paginator.return_value = paginator
    assert s.list_prefix("") == ["a", "b", "c", "d", "e"]


def test_list_prefix_empty_prefix_returns_empty():
    s, c = _make_storage()
    paginator = MagicMock()
    paginator.paginate.return_value = [{}, {"Contents": None}, {"Contents": []}]
    c.get_paginator.return_value = paginator
    # None and empty Contents are both treated as "no results".
    assert s.list_prefix("home-99/") == []


# ---------- copy ----------

def test_copy_uses_server_side_copy():
    s, c = _make_storage()
    s.copy("home-1/daily/2026-05-27/manifest.json.enc",
           "home-1/latest/manifest.json.enc")
    c.copy_object.assert_called_once_with(
        Bucket="test-bucket",
        Key="home-1/latest/manifest.json.enc",
        CopySource={
            "Bucket": "test-bucket",
            "Key": "home-1/daily/2026-05-27/manifest.json.enc",
        },
    )


def test_copy_rejects_empty_keys():
    s, _ = _make_storage()
    with pytest.raises(ValueError):
        s.copy("", "dst")
    with pytest.raises(ValueError):
        s.copy("src", "")


# ---------- from_settings ----------

@pytest.fixture
def _good_env(monkeypatch):
    monkeypatch.setenv("ZIGGY_B2_KEY_ID", "test-key-id")
    monkeypatch.setenv("ZIGGY_B2_APP_KEY", "test-app-key")


_GOOD_SETTINGS = {
    "backup": {
        "b2_endpoint": "https://s3.eu-central-003.backblazeb2.com",
        "b2_bucket": "ziggy-backups-prod",
        "b2_key_id_env": "ZIGGY_B2_KEY_ID",
        "b2_app_key_env": "ZIGGY_B2_APP_KEY",
    },
}


def test_from_settings_builds_storage(_good_env):
    s = BackupStorage.from_settings(_GOOD_SETTINGS)
    assert s.bucket == "ziggy-backups-prod"


def test_from_settings_missing_endpoint_raises(_good_env):
    bad = {"backup": dict(_GOOD_SETTINGS["backup"], b2_endpoint="")}
    with pytest.raises(RuntimeError, match="b2_endpoint"):
        BackupStorage.from_settings(bad)


def test_from_settings_missing_bucket_raises(_good_env):
    bad = {"backup": dict(_GOOD_SETTINGS["backup"], b2_bucket="")}
    with pytest.raises(RuntimeError, match="b2_bucket"):
        BackupStorage.from_settings(bad)


def test_from_settings_missing_key_id_env_raises(monkeypatch):
    monkeypatch.delenv("ZIGGY_B2_KEY_ID", raising=False)
    monkeypatch.setenv("ZIGGY_B2_APP_KEY", "x")
    with pytest.raises(RuntimeError, match="credentials missing"):
        BackupStorage.from_settings(_GOOD_SETTINGS)


def test_from_settings_missing_app_key_env_raises(monkeypatch):
    monkeypatch.setenv("ZIGGY_B2_KEY_ID", "x")
    monkeypatch.delenv("ZIGGY_B2_APP_KEY", raising=False)
    with pytest.raises(RuntimeError, match="credentials missing"):
        BackupStorage.from_settings(_GOOD_SETTINGS)


def test_from_settings_custom_env_var_names(monkeypatch):
    monkeypatch.setenv("WEIRD_KEY_ID", "k")
    monkeypatch.setenv("WEIRD_APP_KEY", "a")
    custom = {
        "backup": dict(
            _GOOD_SETTINGS["backup"],
            b2_key_id_env="WEIRD_KEY_ID",
            b2_app_key_env="WEIRD_APP_KEY",
        ),
    }
    s = BackupStorage.from_settings(custom)
    assert s.bucket == "ziggy-backups-prod"


def test_from_settings_no_backup_section_raises():
    with pytest.raises(RuntimeError):
        BackupStorage.from_settings({})
