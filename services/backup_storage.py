"""Backblaze B2 (S3-compatible) storage wrapper for the backup pipeline.

Thin boto3 wrapper exposing the four operations DESIGN_BACKUP_DR.md §13
Chunk #3 requires:

  upload(data, key)        single PUT, overwrites
  download(key) -> bytes   single GET, raises FileNotFoundError on miss
  list_prefix(prefix)      paginated LIST → list of keys
  copy(src, dst)           same-bucket server-side copy (free in B2)

Design deviation: §13 phrases these as "Functions:" but a class is used
here so (a) tests can inject a mock boto3 client without touching module
globals, and (b) Chunk #8's relay-DB-backup pipeline can instantiate a
second BackupStorage bound to the separate `ziggy-relay-backups` bucket.

No retry / backoff in v1 — per DESIGN_BACKUP_DR.md §6 a failed daily run
logs + skips and the next day's run picks up. If a transient B2 error
ever turns out to be the main cause of skipped runs in the field, we'll
add retry in v1.1; over-eager retry now would just mask real issues.

No streaming / multipart in v1. Typical bundle is well under 100 MB.
If the optional recorder.db ever exceeds B2's 5 GB single-PUT limit
(unlikely with the 500 MB §3 Tier-2 skip threshold), we'll add multipart
in v1.1.

No logging here — callers (backup_engine) own the "uploaded N bytes
to key K" narrative. Keeping this layer mute makes it easier to stub.
"""

from __future__ import annotations

import os
from typing import Optional

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError


class BackupStorage:
    """Bucket-bound boto3 wrapper.

    Construct directly for tests (`BackupStorage(bucket=..., client=mock)`)
    or via `BackupStorage.from_settings()` to read endpoint + bucket from
    settings.yaml and credentials from the env vars named there.
    """

    def __init__(self, *, bucket: str, client: BaseClient):
        if not bucket:
            raise ValueError("bucket must be non-empty")
        if client is None:
            raise ValueError("client must be provided")
        self._bucket = bucket
        self._client = client

    @property
    def bucket(self) -> str:
        return self._bucket

    # -- factory --------------------------------------------------------

    @classmethod
    def from_settings(cls, settings: Optional[dict] = None) -> "BackupStorage":
        """Build a BackupStorage from settings.yaml + env vars.

        `settings` defaults to the global `core.settings_loader.settings`
        so callers in normal runtime don't need to pass anything. Tests
        should construct directly with an explicit `client=` instead of
        going through this path.
        """
        if settings is None:
            from core.settings_loader import settings as global_settings
            settings = global_settings
        section = (settings or {}).get("backup") or {}

        endpoint = section.get("b2_endpoint")
        bucket = section.get("b2_bucket")
        if not endpoint or not bucket:
            raise RuntimeError(
                "settings.yaml backup.b2_endpoint and backup.b2_bucket must both be set"
            )
        # boto3's endpoint_url requires a scheme. Operators often paste the bare
        # S3 host from the Backblaze console (e.g. s3.eu-central-003.backblazeb2.com);
        # normalize it to https:// so a missing scheme isn't a silent failure.
        if "://" not in endpoint:
            endpoint = "https://" + endpoint

        key_id_env = section.get("b2_key_id_env") or "ZIGGY_B2_KEY_ID"
        app_key_env = section.get("b2_app_key_env") or "ZIGGY_B2_APP_KEY"
        key_id = os.environ.get(key_id_env, "")
        app_key = os.environ.get(app_key_env, "")
        if not key_id or not app_key:
            raise RuntimeError(
                f"B2 credentials missing: env vars {key_id_env!r} and {app_key_env!r} "
                "must both be set. See config/settings.example.yaml."
            )

        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key_id,
            aws_secret_access_key=app_key,
        )
        return cls(bucket=bucket, client=client)

    # -- operations -----------------------------------------------------

    def upload(self, data: bytes, key: str) -> None:
        """Upload `data` to {bucket}/{key}. Overwrites without warning."""
        if not isinstance(data, (bytes, bytearray)):
            raise TypeError(f"data must be bytes, got {type(data).__name__}")
        if not key:
            raise ValueError("key must be non-empty")
        self._client.put_object(Bucket=self._bucket, Key=key, Body=bytes(data))

    def download(self, key: str) -> bytes:
        """Fetch {bucket}/{key} as bytes. Raises FileNotFoundError if missing."""
        if not key:
            raise ValueError("key must be non-empty")
        try:
            resp = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404"):
                raise FileNotFoundError(f"b2://{self._bucket}/{key}") from e
            raise
        return resp["Body"].read()

    def list_prefix(self, prefix: str) -> list[str]:
        """All object keys under `prefix`, paginated. Empty list if no matches.

        `prefix` may be empty to list the whole bucket — useful in tests
        but a footgun in production; callers in the engine should always
        scope by `{home_id}/`.
        """
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for obj in page.get("Contents") or []:
                keys.append(obj["Key"])
        return keys

    def copy(self, src_key: str, dst_key: str) -> None:
        """Server-side copy within the same bucket. Free in B2 (no egress)."""
        if not src_key or not dst_key:
            raise ValueError("src_key and dst_key must both be non-empty")
        self._client.copy_object(
            Bucket=self._bucket,
            Key=dst_key,
            CopySource={"Bucket": self._bucket, "Key": src_key},
        )
