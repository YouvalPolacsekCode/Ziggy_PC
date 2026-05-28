"""90-day post-cancellation B2 retention cron (Prompt 9 chunk 3, decision 9).

Each daily invocation:
  1. Queries homes with subscription_state='cancelled' AND
     cancelled_at < now - RETENTION_DAYS.
  2. For each, lists and deletes every B2 object under {home_id}/.
  3. Writes per-deletion + per-run audit_log rows.

Why a custom cron instead of B2 lifecycle rules (per founder decision):
  * B2 lifecycle rules apply per prefix and don't condition on
    subscription state — we'd need to MOVE objects to a "cancelled/"
    prefix and then let lifecycle do TTL, which is more moving parts
    than a 50-line Python script that just deletes.
  * The cron is auditable end-to-end via audit_log — every deletion
    leaves a trail.
  * If we ever change the policy (e.g. 60 days for refunded, 90 for
    cancelled) it's one branch in Python instead of a Backblaze
    console reconfiguration the founder must remember to keep in
    sync.

Required env (Fly secrets):
  B2_ENDPOINT_URL    e.g. https://s3.eu-central-003.backblazeb2.com
  B2_BUCKET          e.g. ziggy-backups-prod
  B2_ADMIN_KEY_ID    admin key id with delete permission on the bucket
  B2_ADMIN_APP_KEY   admin key secret
  B2_REGION          optional, defaults to 'eu-central-003'

These are SEPARATE from the per-home B2 keys that get sealed with the
master key — those keys are write-only-to-their-prefix. The admin
credentials are needed because the relay never holds the per-home
unwrapped keys (master is in 1Password, not on Fly).

CLI:
  python -m relay.app.billing.retention --once
  python -m relay.app.billing.retention --once --dry-run

Scheduling is an ops task (Fly machine cron, fly.toml entry, or a
relay-side scheduler loop) — the runbook lives outside this module.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..audit import log_event
from ..database import get_db


log = logging.getLogger(__name__)

# Founder decision 9: 90 days. Long enough for most practical
# "I changed my mind" recovery windows; short enough to bound storage
# cost for cancelled hubs.
RETENTION_DAYS = 90


def _build_b2_client() -> Optional[Any]:
    """Return a boto3 S3 client configured for B2 admin access, or None
    if env is unset (skips the run cleanly so a misconfigured relay
    doesn't blow up at 02:00)."""
    key_id = os.getenv("B2_ADMIN_KEY_ID", "")
    app_key = os.getenv("B2_ADMIN_APP_KEY", "")
    endpoint = os.getenv("B2_ENDPOINT_URL", "")
    region = os.getenv("B2_REGION", "eu-central-003")
    if not (key_id and app_key and endpoint):
        return None
    # Late import — boto3 is in relay/requirements.txt but a relay
    # without B2 retention configured shouldn't pay the import cost
    # at boot.
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=app_key,
        region_name=region,
    )


def _find_cancelled_old_homes_sql() -> str:
    # cancelled_at is set by the customer.subscription.deleted webhook
    # (relay/app/billing/webhooks.py:_handle_subscription_deleted) so
    # any row with subscription_state='cancelled' will have a
    # populated cancelled_at — defensive ISNULL guard regardless.
    return (
        "SELECT id, cancelled_at FROM homes "
        "WHERE subscription_state='cancelled' "
        "AND cancelled_at IS NOT NULL "
        "AND cancelled_at <= ?"
    )


async def _find_cancelled_old_homes(cutoff_iso: str) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            _find_cancelled_old_homes_sql(), (cutoff_iso,)
        )
    return [dict(r) for r in rows]


def _list_objects(b2_client: Any, bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = b2_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def _delete_objects(b2_client: Any, bucket: str, keys: list[str]) -> int:
    """Delete keys in batches of up to 1000 (S3 DeleteObjects max).
    Returns the number of successfully deleted keys."""
    if not keys:
        return 0
    deleted = 0
    for start in range(0, len(keys), 1000):
        batch = keys[start:start + 1000]
        resp = b2_client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
        )
        # `Quiet=True` suppresses successful entries; only errors come
        # back in the response.
        errors = resp.get("Errors") or []
        deleted += len(batch) - len(errors)
        for err in errors:
            log.warning(
                "b2 delete error key=%s code=%s msg=%s",
                err.get("Key"), err.get("Code"), err.get("Message"),
            )
    return deleted


async def run_once(
    *,
    dry_run: bool = False,
    now: Optional[datetime] = None,
    b2_client_factory: Any = _build_b2_client,
) -> dict:
    """One retention pass. Safe to call manually for testing.

    Returns a summary dict: {
      "checked":      int  homes eligible by age + state
      "deleted":      int  total B2 objects deleted across all homes
      "skipped":      list[home_id]  homes skipped (no B2 client / empty prefix)
      "errors":       list[(home_id, err_str)]
      "dry_run":      bool
    }
    """
    if now is None:
        now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=RETENTION_DAYS)).isoformat()

    homes = await _find_cancelled_old_homes(cutoff)
    summary: dict = {
        "checked":      len(homes),
        "deleted":      0,
        "skipped":      [],
        "errors":       [],
        "dry_run":      dry_run,
    }

    if not homes:
        await log_event(
            "b2_retention_run", ok=True,
            detail=f"cutoff={cutoff} eligible=0 dry_run={dry_run}",
        )
        return summary

    b2_client = b2_client_factory()
    if b2_client is None:
        # No B2 credentials wired up. Mark every eligible home as
        # skipped + audit-log the misconfiguration so the founder
        # notices at the next dashboard sweep.
        for h in homes:
            summary["skipped"].append(h["id"])
        await log_event(
            "b2_retention_run", ok=False,
            detail=(f"cutoff={cutoff} eligible={len(homes)} skipped_all "
                    f"reason=missing_b2_admin_env"),
        )
        return summary

    bucket = os.getenv("B2_BUCKET", "")
    if not bucket:
        for h in homes:
            summary["skipped"].append(h["id"])
        await log_event(
            "b2_retention_run", ok=False,
            detail=(f"cutoff={cutoff} eligible={len(homes)} skipped_all "
                    f"reason=missing_B2_BUCKET"),
        )
        return summary

    for h in homes:
        home_id = h["id"]
        prefix = f"{home_id}/"
        try:
            keys = _list_objects(b2_client, bucket, prefix)
            if not keys:
                summary["skipped"].append(home_id)
                await log_event(
                    "b2_retention_home", home_id=home_id, ok=True,
                    detail=f"prefix={prefix} keys=0 (nothing to delete)",
                )
                continue
            if dry_run:
                await log_event(
                    "b2_retention_home", home_id=home_id, ok=True,
                    detail=f"prefix={prefix} keys={len(keys)} dry_run",
                )
                continue
            deleted = _delete_objects(b2_client, bucket, keys)
            summary["deleted"] += deleted
            await log_event(
                "b2_retention_home", home_id=home_id, ok=True,
                detail=(f"prefix={prefix} listed={len(keys)} "
                        f"deleted={deleted}"),
            )
        except Exception as e:
            summary["errors"].append((home_id, f"{type(e).__name__}: {e}"))
            await log_event(
                "b2_retention_home", home_id=home_id, ok=False,
                detail=f"prefix={prefix} err={type(e).__name__}: {e}",
            )

    await log_event(
        "b2_retention_run", ok=(not summary["errors"]),
        detail=(f"cutoff={cutoff} eligible={summary['checked']} "
                f"deleted={summary['deleted']} skipped={len(summary['skipped'])} "
                f"errors={len(summary['errors'])} dry_run={dry_run}"),
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description="B2 90-day post-cancellation retention cron.",
    )
    parser.add_argument("--once", action="store_true",
                        help="Run one pass and exit (required; daemon mode TBD).")
    parser.add_argument("--dry-run", action="store_true",
                        help="List eligible objects without deleting.")
    args = parser.parse_args()

    if not args.once:
        parser.error("--once is required (only mode supported today).")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    summary = asyncio.run(run_once(dry_run=args.dry_run))
    print(summary)


if __name__ == "__main__":
    main()
