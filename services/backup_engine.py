"""Daily backup orchestrator for the Ziggy hub.

Implements the §6 backup flow end-to-end:

    pre-flight    → NTP, disk space, B2 reachability, data_key present
    zigbee backup → ZHA: trigger zha.network_backup, locate fresh .storage file
                    Z2M: tar.gz the Z2M data dir (database.db, configuration,
                         coordinator_backup.json, state)
    collect       → tar.gz HA config (allowlist), Ziggy state, recorder DB
    encrypt       → AES-256-GCM per file with HKDF-derived subkeys
    manifest      → JSON + HMAC-SHA256, encrypted under its own subkey;
                    stamped with `zigbee_stack` so restore knows which path
    upload        → push everything to B2 under {home_id}/daily/{YYYY-MM-DD}/
    promote       → server-side copy to {home_id}/latest/

Stack detection is by disk presence (see `_detect_zigbee_stack`) — more
reliable than an HA WebSocket round-trip from a backup process and
identical to what a restore script sees on the target machine.

Calls into services/backup_keys (Chunk #2) and services/backup_storage
(Chunk #3). Nothing here speaks to the scheduler — Chunk #5 wires the
daily tick that invokes `run_daily_backup_from_settings()`.

Design contracts honored:

- Explicit HA `.storage/` allowlist via HA_STORAGE_PREFIX_ALLOWLIST.
  We never tar-and-exclude; we tar-and-include. Anything we don't
  recognize is left out of the bundle.
- NTP pre-flight via chronyd then systemd-timesyncd fallback. Skew
  must be within ±60s of real time (DESIGN_BACKUP_DR.md §6). Skipping
  the run is preferable to landing a backup in the wrong daily folder.
- Manifest stamped with `schema_version: 1`. The reader (Chunk #9
  restore script) MUST refuse to proceed on any schema_version > the
  KNOWN constant — better to halt than to silently misinterpret.
- Per design §6 step 12: any failure logs + aborts the day; we never
  retry within the same run. The scheduler picks up tomorrow.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import io
import json
import logging
import os
import re
import socket
import sqlite3
import subprocess
import tarfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests

from core.relay_signing import sign as sign_relay_signature
from services import backup_keys
from services.backup_storage import BackupStorage

# fcntl is POSIX-only. On Windows the file lock is silently skipped —
# production target is Ubuntu, and the founder's Windows dev box doesn't
# need flock semantics for a single-process manual --once run.
try:
    import fcntl as _fcntl
    _HAS_FCNTL = True
except ImportError:
    _fcntl = None  # type: ignore[assignment]
    _HAS_FCNTL = False

log = logging.getLogger(__name__)


# ---------- versions & constants ----------

SCHEMA_VERSION = 1

# Tolerance for clock skew before we refuse to back up.
NTP_TOLERANCE_S = 60.0

# Default file lock; configurable for tests via BackupContext.lock_path.
DEFAULT_LOCK_PATH = "/var/run/ziggy-backup.lock"

# Files inside ha-config/.storage/ — we ship anything whose name starts
# with one of these prefixes. Registries (core.*), auth, lovelace, ZHA,
# integrations, and input_* helpers. Cache files (deps/, tts/, .cloud/,
# the recorder DB, logs) are NEVER allowlisted — they're regenerable
# or handled separately.
HA_STORAGE_PREFIX_ALLOWLIST: tuple[str, ...] = (
    "auth",
    "auth_provider.",
    "core.",
    "frontend.",
    "input_",
    "integrations.",
    "lovelace",
    "person.",
    "repairs.",
    "scenes",
    "scripts",
    "system_log",
    "zha",
)

# Top-level files in ha-config/ — single-file YAMLs that may exist.
HA_TOP_LEVEL_FILES: tuple[str, ...] = (
    "automations.yaml",
    "configuration.yaml",
    "customize.yaml",
    "groups.yaml",
    "known_devices.yaml",
    "scenes.yaml",
    "scripts.yaml",
    "secrets.yaml",
    "ui-lovelace.yaml",
)

# Top-level directories in ha-config/ — fully recursed if present.
HA_TOP_LEVEL_DIRS: tuple[str, ...] = (
    "blueprints",
    "custom_components",
    "python_scripts",
    "themes",
)

# Filename of HA's recorder SQLite DB; sized + skipped per §3 Tier-2.
RECORDER_FILENAME = "home-assistant_v2.db"

# HKDF info string used to derive the manifest's own HMAC key from the
# per-home data_key. Versioned so a future change can't collide.
_MANIFEST_HMAC_INFO = b"ziggy-backup-manifest-hmac-v1"


# ---------- public entry point ----------

@dataclass
class BackupContext:
    """Everything one daily run needs. Built from settings + env at runtime;
    constructed directly with tmp paths and mock clients in tests.
    """
    home_id: str
    device_id: str
    coordinator_type: str
    data_key: bytes
    ha_config_dir: Path
    z2m_data_dir: Path
    user_files_dir: Path
    config_dir: Path
    storage: BackupStorage
    ha_url: str
    ha_token: str

    coordinator_ieee: Optional[str] = None
    ziggy_version: str = "0.0.0+local"
    ha_version: Optional[str] = None
    today: dt.date = field(default_factory=lambda: dt.date.today())
    recorder_skip_threshold_mb: int = 500
    lock_path: str = DEFAULT_LOCK_PATH
    dry_run: bool = False

    # Relay status-report config. Optional: when relay_url + relay_secret are
    # both present, the engine POSTs the run outcome to
    #   {relay_url}/api/homes/{home_id}/backup-status
    # signed with X-Ziggy-Signature so the founder GET sees an audit trail.
    # Left as None on dev/test hubs that aren't paired with a relay yet; the
    # POST is skipped and the backup itself is unaffected.
    relay_url: Optional[str] = None
    relay_secret: Optional[str] = None

    # Tests inject substitutes via these hooks. Production leaves them None
    # and the real subprocess/requests/socket calls run.
    _ntp_skew_provider: Optional[callable] = None
    _ha_post: Optional[callable] = None
    _now: Optional[callable] = None
    # Hook for the relay status POST. Signature:
    #   (url: str, headers: dict, body: bytes, timeout: float) -> int
    # Returns the HTTP status code. Tests inject a mock; production leaves
    # this None and requests.post is used.
    _relay_post: Optional[callable] = None


def run_daily_backup(ctx: BackupContext) -> dict:
    """Execute one daily backup cycle. Returns a result dict.

    The dict shape (also written to the audit log by the caller):
      {
        "ok": bool,
        "stage": "preflight" | "zha" | "collect" | "encrypt" | "upload" | "done",
        "uploaded_bytes": int,
        "files": [filenames],
        "optional_skipped": [filenames],
        "error": str | None,
      }

    Any raised exception is caught and surfaced via the dict — the
    scheduler must never see an unhandled error from this function.
    """
    result: dict = {
        "ok": False,
        "stage": "preflight",
        "uploaded_bytes": 0,
        "files": [],
        "optional_skipped": [],
        "error": None,
        "skipped_reason": None,
        "zigbee_stack": None,
    }
    try:
        _preflight(ctx)

        zigbee_stack = _detect_zigbee_stack(ctx)
        result["zigbee_stack"] = zigbee_stack
        result["stage"] = "zigbee"
        zigbee_bundle_name: Optional[str] = None
        zigbee_bundle_bytes: Optional[bytes] = None
        if zigbee_stack == "zha":
            zha_backup_bytes, _zha_path = _trigger_and_read_zha_backup(ctx)
            zigbee_bundle_name = "zha-network-backup.json.enc"
            zigbee_bundle_bytes = zha_backup_bytes
        elif zigbee_stack == "z2m":
            z2m_bytes, _z2m_included = _collect_z2m_data(ctx)
            zigbee_bundle_name = "z2m-data.tar.gz.enc"
            zigbee_bundle_bytes = z2m_bytes
        else:
            # No Zigbee stack on disk — log it, ship the rest. A hub with
            # only IR/Switcher/Matter devices is legitimate.
            result["optional_skipped"].append("zigbee-backup")
            log.warning("backup: no Zigbee stack detected on disk; skipping zigbee bundle")

        result["stage"] = "collect"
        ha_bytes, ha_included = _collect_ha_config(ctx)
        ziggy_bytes = _collect_ziggy_state(ctx)
        recorder_bytes, recorder_skipped = _collect_recorder_db(ctx)
        if recorder_skipped:
            result["optional_skipped"].append("recorder.db")

        bundles: dict[str, bytes] = {
            "ha-config.tar.gz.enc": ha_bytes,
            "ziggy-state.tar.gz.enc": ziggy_bytes,
        }
        if zigbee_bundle_name and zigbee_bundle_bytes is not None:
            bundles[zigbee_bundle_name] = zigbee_bundle_bytes
        if recorder_bytes is not None:
            bundles["recorder.db.enc"] = recorder_bytes

        result["stage"] = "encrypt"
        encrypted = _encrypt_files(ctx, bundles)

        manifest_plain = _build_manifest(
            ctx,
            encrypted=encrypted,
            optional_skipped=result["optional_skipped"],
            zigbee_stack=zigbee_stack,
        )
        encrypted_manifest = _encrypt_manifest(ctx, manifest_plain)
        result["files"] = list(encrypted.keys()) + ["manifest.json.enc"]

        result["stage"] = "upload"
        if not ctx.dry_run:
            uploaded_bytes = _upload_all(ctx, encrypted, encrypted_manifest)
            result["uploaded_bytes"] = uploaded_bytes
            _promote_to_latest(ctx, list(encrypted.keys()) + ["manifest.json.enc"])
        else:
            result["uploaded_bytes"] = sum(
                len(b["nonce"]) + len(b["ciphertext"]) + len(b["tag"])
                for b in encrypted.values()
            ) + len(encrypted_manifest["ciphertext"])
            log.info("dry-run: skipped upload + promote (would have uploaded %d bytes)",
                     result["uploaded_bytes"])

        result["ok"] = True
        result["stage"] = "done"
        log.info("backup ok home=%s files=%d bytes=%d included_ha=%s",
                 ctx.home_id, len(result["files"]),
                 result["uploaded_bytes"], ha_included)
    except BackupGated as gate_err:
        # Distinct path from genuine errors: ok stays False (no work
        # done) but error stays None and skipped_reason records why.
        # Logged at INFO so cancelled hubs don't generate ops noise.
        result["skipped_reason"] = "subscription_gated"
        log.info("backup skipped: %s", gate_err)
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        log.error("backup failed at stage=%s: %s", result["stage"], e, exc_info=True)

    # Report outcome to the relay (success OR failure). Wrapped in a broad
    # try/except so a relay outage cannot poison an otherwise successful
    # backup. Skipped silently when relay creds are not configured so the
    # backup engine remains usable on dev hubs not paired with the relay.
    try:
        _report_status_to_relay(ctx, result)
    except Exception as e:
        log.warning("relay backup-status POST failed (non-fatal): %s", e)

    return result


# ---------- pre-flight ----------


class BackupGated(RuntimeError):
    """Backup intentionally skipped because the subscription is not active.

    Distinct from a true preflight failure (e.g. NTP skew, disk full).
    The scheduler / caller can recognize this and avoid alerting; the
    audit log records the skip with reason="subscription_gated" rather
    than as an error.
    """


def _preflight(ctx: BackupContext) -> None:
    _check_subscription_active(ctx)
    _check_ntp_sync(ctx)
    _check_data_key(ctx)
    _check_disk_space(ctx)
    _check_b2_reachable(ctx)


def _check_subscription_active(ctx: BackupContext) -> None:
    """Subscription gate (Prompt 9 chunk 3). Raises BackupGated on inactive.

    Reads the edge cache populated by services/ota_client.py from the
    relay's signed OTA manifest. Semantics (see
    services/subscription_state.py):

      missing cache → ALLOW  (fresh-install backward-compat)
      stale cache   → ALLOW  (permissive — relay outages must not
                              destroy a paying customer's backup chain)
      fresh+active  → ALLOW
      fresh+other   → DENY   (cancelled / past_due / refunded /
                              pending_setup — backup engine writes no
                              new objects to B2; existing objects are
                              left for the 90-day retention cron to
                              prune per founder decision 9)

    Skipping here is a planned no-op, not a failure. The local kit
    (sensors, automations, IR, local voice) is unaffected.
    """
    # Import inside the function so the module remains importable in
    # test contexts that don't have user_files/ writable.
    from services.subscription_state import is_backup_allowed
    if not is_backup_allowed():
        raise BackupGated(
            "Backup skipped: subscription is not active. "
            "Sensors, automations, IR, and local voice continue normally."
        )


def _check_ntp_sync(ctx: BackupContext) -> None:
    """Refuse to back up if the clock is more than ±60s out.

    Tests inject `_ntp_skew_provider`. In production we try chronyd
    (numeric offset available) then fall back to systemd-timesyncd
    (binary synced-yes/no — we trust "yes" as ~0 skew).
    """
    if ctx._ntp_skew_provider is not None:
        skew = ctx._ntp_skew_provider()
    else:
        skew = _query_chrony_skew()
        if skew is None:
            skew = _query_timesyncd_skew()
    if skew is None:
        raise RuntimeError(
            "NTP sync source unavailable (chronyd / systemd-timesyncd both silent). "
            "Refusing to back up — risk of landing in wrong daily folder."
        )
    if abs(skew) > NTP_TOLERANCE_S:
        raise RuntimeError(
            f"Clock skew {skew:.1f}s exceeds ±{NTP_TOLERANCE_S:.0f}s tolerance — skipping backup."
        )


def _query_chrony_skew() -> Optional[float]:
    """Return clock offset in seconds via chronyc, or None if unavailable."""
    try:
        proc = subprocess.run(
            ["chronyc", "tracking"],
            capture_output=True, text=True, timeout=5, check=False,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    # Sample: "System time     : 0.000123456 seconds slow of NTP time"
    for line in proc.stdout.splitlines():
        m = re.match(r"\s*System time\s*:\s*([0-9.eE+-]+)\s+seconds\s+(slow|fast)", line)
        if m:
            value = float(m.group(1))
            return -value if m.group(2) == "slow" else value
    return None


def _query_timesyncd_skew() -> Optional[float]:
    """Return 0.0 if timesyncd reports synced=yes; None otherwise."""
    try:
        proc = subprocess.run(
            ["timedatectl", "status"],
            capture_output=True, text=True, timeout=5, check=False,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        if "synchronized:" in line.lower():
            return 0.0 if "yes" in line.lower() else None
    return None


def _check_data_key(ctx: BackupContext) -> None:
    if not isinstance(ctx.data_key, (bytes, bytearray)) or len(ctx.data_key) != 32:
        raise RuntimeError("data_key missing or wrong length — cannot back up")


def _check_disk_space(ctx: BackupContext) -> None:
    """Need at least 2 GB free on /tmp for bundle staging — generous floor."""
    try:
        stat = os.statvfs("/tmp")
    except (FileNotFoundError, OSError):
        log.warning("disk-space check: /tmp unavailable, skipping")
        return
    free_bytes = stat.f_bavail * stat.f_frsize
    if free_bytes < 2 * 1024 * 1024 * 1024:
        raise RuntimeError(f"/tmp has only {free_bytes // (1024*1024)} MB free — need ≥2 GB")


def _check_b2_reachable(ctx: BackupContext) -> None:
    """Cheap reachability probe — list one key under our home prefix."""
    try:
        ctx.storage.list_prefix(f"{ctx.home_id}/.probe/")
    except Exception as e:
        raise RuntimeError(f"B2 unreachable: {e}") from e


# ---------- Zigbee backup (ZHA or Z2M) ----------

# Files inside the Z2M data dir that the backup MUST include. database.db is
# the persistent device DB; coordinator_backup.json is the network params
# the restore script needs to reform the mesh; configuration.yaml is the
# operator config. state.json is current device state — useful but
# regenerable, so optional.
_Z2M_REQUIRED_FILES: tuple[str, ...] = (
    "database.db",
    "coordinator_backup.json",
    "configuration.yaml",
)
_Z2M_OPTIONAL_FILES: tuple[str, ...] = (
    "state.json",
)
# Skipped on purpose: log/, *.log, cache/, *.bak — regenerable noise that
# would inflate the encrypted bundle for no restore value.


def _detect_zigbee_stack(ctx: "BackupContext") -> str:
    """Return 'zha', 'z2m', or 'none' based on what's on disk.

    Disk presence beats an HA round-trip: it's what the restore script
    will see on the target machine, and it doesn't depend on HA being up
    at backup time. If both stacks have on-disk state we prefer Z2M (the
    post-migration world); a leftover ZHA dir during the 1-week rollback
    window shouldn't pull us back to the old code path.
    """
    z2m_db = ctx.z2m_data_dir / "database.db"
    zha_marker = ctx.ha_config_dir / ".storage" / "zha"
    if z2m_db.is_file():
        return "z2m"
    if zha_marker.exists():
        return "zha"
    return "none"


def _trigger_and_read_zha_backup(ctx: "BackupContext") -> tuple[bytes, Path]:
    """Call zha.network_backup, then read the freshest matching file.

    Returns (bytes, source_path). Raises if no fresh file appears within
    the 5-minute window or if the HA call returns non-2xx.
    """
    poster = ctx._ha_post or _ha_service_call
    now = (ctx._now or dt.datetime.now)
    cutoff = now() - dt.timedelta(minutes=5)

    resp_code = poster(ctx.ha_url, ctx.ha_token, "zha", "network_backup", {})
    if not (200 <= resp_code < 300):
        raise RuntimeError(f"zha.network_backup returned HTTP {resp_code}")

    storage = ctx.ha_config_dir / ".storage"
    if not storage.is_dir():
        raise RuntimeError(f"ha-config/.storage not found at {storage}")

    candidates = sorted(
        (p for p in storage.iterdir()
         if p.is_file() and p.name.startswith("core.zigbee_network_backup")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("zha.network_backup did not produce a file in .storage/")
    fresh = candidates[0]
    mtime = dt.datetime.fromtimestamp(fresh.stat().st_mtime)
    if mtime < cutoff:
        raise RuntimeError(
            f"latest zigbee_network_backup is from {mtime.isoformat()} — "
            "older than 5-minute freshness window"
        )
    return fresh.read_bytes(), fresh


def _collect_z2m_data(ctx: "BackupContext") -> tuple[bytes, list[str]]:
    """tar.gz the Z2M data dir. Returns (bytes, included_filenames).

    Includes the required device DB + coordinator backup + config; pulls
    in optional state.json when present. Excludes logs, caches, and any
    .bak files. Raises if the data dir or any required file is missing —
    a Z2M install without database.db is a misconfiguration we want to
    surface loudly rather than ship a useless backup.
    """
    if not ctx.z2m_data_dir.is_dir():
        raise RuntimeError(f"z2m_data_dir does not exist: {ctx.z2m_data_dir}")
    included: list[str] = []
    missing_required: list[str] = []
    for name in _Z2M_REQUIRED_FILES:
        if not (ctx.z2m_data_dir / name).is_file():
            missing_required.append(name)
    if missing_required:
        raise RuntimeError(
            f"z2m data dir missing required file(s): {', '.join(missing_required)}"
        )
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in _Z2M_REQUIRED_FILES:
            p = ctx.z2m_data_dir / name
            tar.add(p, arcname=name)
            included.append(name)
        for name in _Z2M_OPTIONAL_FILES:
            p = ctx.z2m_data_dir / name
            if p.is_file():
                tar.add(p, arcname=name)
                included.append(name)
        # External converters dir — small but critical when present (we'll
        # need it for the HOBEIAN trio if Z2M's generic Tuya converter
        # doesn't pick them up).
        ext = ctx.z2m_data_dir / "external_converters"
        if ext.is_dir():
            tar.add(ext, arcname="external_converters")
            included.append("external_converters/")
    return buf.getvalue(), included


def _ha_service_call(ha_url: str, ha_token: str, domain: str, service: str, payload: dict) -> int:
    """POST to HA REST. Returns the HTTP status code."""
    url = ha_url.rstrip("/") + f"/api/services/{domain}/{service}"
    headers = {"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"}
    resp = requests.post(url, headers=headers, json=payload, timeout=90)
    return resp.status_code


# ---------- collection ----------

def _collect_ha_config(ctx: BackupContext) -> tuple[bytes, list[str]]:
    """tar.gz HA config using the explicit allowlist. Returns (bytes, included)."""
    if not ctx.ha_config_dir.is_dir():
        raise RuntimeError(f"ha_config_dir does not exist: {ctx.ha_config_dir}")
    included: list[str] = []
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in HA_TOP_LEVEL_FILES:
            p = ctx.ha_config_dir / name
            if p.is_file():
                tar.add(p, arcname=name)
                included.append(name)
        for name in HA_TOP_LEVEL_DIRS:
            p = ctx.ha_config_dir / name
            if p.is_dir():
                tar.add(p, arcname=name)  # tarfile recurses by default
                included.append(name + "/")
        storage = ctx.ha_config_dir / ".storage"
        if storage.is_dir():
            for f in sorted(storage.iterdir()):
                if not f.is_file():
                    continue
                if any(f.name.startswith(p) for p in HA_STORAGE_PREFIX_ALLOWLIST):
                    tar.add(f, arcname=f".storage/{f.name}")
                    included.append(f".storage/{f.name}")
    return buf.getvalue(), included


def _collect_ziggy_state(ctx: BackupContext) -> bytes:
    """tar.gz user_files/ + config/. SQLite files inside user_files are read
    live — same as HA's config files. Acceptable risk per §6 (small writes,
    overwhelmingly idle). The HA recorder DB gets the proper sqlite3.backup
    treatment via _collect_recorder_db.
    """
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        if ctx.user_files_dir.is_dir():
            tar.add(ctx.user_files_dir, arcname="user_files")
        if ctx.config_dir.is_dir():
            tar.add(ctx.config_dir, arcname="config")
    return buf.getvalue()


def _collect_recorder_db(ctx: BackupContext) -> tuple[Optional[bytes], bool]:
    """Snapshot HA's recorder DB if present and ≤ threshold.

    Returns (raw_db_bytes_or_None, was_skipped). When the file exists but
    exceeds recorder_skip_threshold_mb, we return (None, True) so the
    caller can tag it 'optional_skipped' in the manifest.
    """
    src = ctx.ha_config_dir / RECORDER_FILENAME
    if not src.is_file():
        return None, False
    size_mb = src.stat().st_size / (1024 * 1024)
    if size_mb > ctx.recorder_skip_threshold_mb:
        log.warning("recorder.db is %.0f MB > %d MB threshold — skipping",
                    size_mb, ctx.recorder_skip_threshold_mb)
        return None, True
    return _snapshot_sqlite(src), False


def _snapshot_sqlite(src: Path) -> bytes:
    """Use sqlite3's online backup API to read a consistent snapshot.

    Avoids the half-write tear that would come from tarring a live DB
    while HA holds writer locks. Returns the snapshot bytes.
    """
    src_conn = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    try:
        with io.BytesIO() as memfile:
            # sqlite3 can backup to disk only; use a temp file path.
            import tempfile
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


# ---------- encryption ----------

def _encrypt_files(ctx: BackupContext, plaintexts: dict[str, bytes]) -> dict[str, dict]:
    """Encrypt each file under a key derived from its name. Returns a dict:

        {filename_with_enc_suffix: {nonce, ciphertext, tag, sha256_of_plaintext, size}}

    The encrypted-suffix filename (e.g. "ha-config.tar.gz.enc") is used as
    the HKDF salt — the SAME name a restore script will compute when
    deriving the key for decryption.
    """
    out: dict[str, dict] = {}
    for name, plaintext in plaintexts.items():
        fk = backup_keys.derive_file_key(ctx.data_key, name)
        nonce, ct, tag = backup_keys.encrypt_file(plaintext, fk)
        out[name] = {
            "nonce": nonce,
            "ciphertext": ct,
            "tag": tag,
            "sha256_plaintext": hashlib.sha256(plaintext).hexdigest(),
            "size_plaintext": len(plaintext),
        }
    return out


# ---------- manifest ----------

def _build_manifest(
    ctx: BackupContext,
    *,
    encrypted: dict[str, dict],
    optional_skipped: list[str],
    zigbee_stack: str = "none",
) -> bytes:
    """Assemble manifest JSON bytes (UTF-8). HMAC is added by _sign_manifest.

    `zigbee_stack` tells the restore script which file to expect for the
    Zigbee bundle ('zha' → zha-network-backup.json.enc, 'z2m' →
    z2m-data.tar.gz.enc, 'none' → no Zigbee bundle in this backup).
    """
    now = (ctx._now or dt.datetime.utcnow)()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "home_id": ctx.home_id,
        "device_id": ctx.device_id,
        "created_at": now.replace(microsecond=0).isoformat() + "Z",
        "ziggy_version": ctx.ziggy_version,
        "ha_version": ctx.ha_version,
        "coordinator_type": ctx.coordinator_type,
        "coordinator_ieee": ctx.coordinator_ieee,
        "zigbee_stack": zigbee_stack,
        "files": [
            {
                "name": name,
                "size_plaintext": meta["size_plaintext"],
                "sha256_plaintext": meta["sha256_plaintext"],
                "nonce": base64.b64encode(meta["nonce"]).decode(),
                "tag": base64.b64encode(meta["tag"]).decode(),
            }
            for name, meta in sorted(encrypted.items())
        ],
        "optional_skipped": sorted(optional_skipped),
    }
    return json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _manifest_hmac_key(data_key: bytes) -> bytes:
    """Derive the manifest-HMAC key from the data_key via HKDF-SHA256.

    Separate from the per-file subkeys derived in backup_keys.derive_file_key,
    so the manifest's MAC can't collide with any file's encryption key.
    """
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"",
        info=_MANIFEST_HMAC_INFO,
    ).derive(data_key)


def sign_manifest(manifest_bytes: bytes, data_key: bytes) -> bytes:
    """Public so the restore script (Chunk #9) can verify. Raw HMAC bytes."""
    return hmac.new(_manifest_hmac_key(data_key), manifest_bytes, hashlib.sha256).digest()


def verify_manifest_signature(manifest_bytes: bytes, signature: bytes, data_key: bytes) -> bool:
    """Constant-time verify. False if mismatch or wrong key."""
    expected = sign_manifest(manifest_bytes, data_key)
    return hmac.compare_digest(expected, signature)


def parse_manifest(plaintext_json: bytes) -> dict:
    """Restore-side helper. Raises if schema_version is missing or newer than KNOWN."""
    try:
        data = json.loads(plaintext_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"manifest JSON malformed: {e}") from e
    v = data.get("schema_version")
    if not isinstance(v, int):
        raise ValueError("manifest missing schema_version")
    if v > SCHEMA_VERSION:
        raise ValueError(
            f"manifest schema_version {v} > supported {SCHEMA_VERSION} — "
            "agent too old to interpret this backup; upgrade Ziggy first."
        )
    return data


def _encrypt_manifest(ctx: BackupContext, manifest_bytes: bytes) -> dict:
    """Sign then encrypt the manifest. Signature is bundled inside the
    ciphertext (not stored alongside) so it can't be stripped or replayed.
    """
    signature = sign_manifest(manifest_bytes, ctx.data_key)
    signed = json.dumps({
        "manifest": base64.b64encode(manifest_bytes).decode(),
        "hmac": base64.b64encode(signature).decode(),
    }).encode("utf-8")
    fk = backup_keys.derive_file_key(ctx.data_key, "manifest.json.enc")
    nonce, ct, tag = backup_keys.encrypt_file(signed, fk)
    return {"nonce": nonce, "ciphertext": ct, "tag": tag}


# ---------- upload ----------

def _backup_key_for(home_id: str, date: dt.date, filename: str) -> str:
    """B2 object key under daily/."""
    return f"{home_id}/daily/{date.isoformat()}/{filename}"


def _latest_key_for(home_id: str, filename: str) -> str:
    return f"{home_id}/latest/{filename}"


def _upload_all(
    ctx: BackupContext,
    encrypted: dict[str, dict],
    encrypted_manifest: dict,
) -> int:
    """Upload every bundle + manifest to {home_id}/daily/{today}/. Returns total bytes."""
    total = 0
    for name, meta in encrypted.items():
        blob = meta["nonce"] + meta["ciphertext"] + meta["tag"]
        ctx.storage.upload(blob, _backup_key_for(ctx.home_id, ctx.today, name))
        total += len(blob)
    manifest_blob = (
        encrypted_manifest["nonce"]
        + encrypted_manifest["ciphertext"]
        + encrypted_manifest["tag"]
    )
    ctx.storage.upload(manifest_blob,
                       _backup_key_for(ctx.home_id, ctx.today, "manifest.json.enc"))
    total += len(manifest_blob)
    return total


def _promote_to_latest(ctx: BackupContext, filenames: list[str]) -> None:
    """Server-side copy from daily/{today}/ → latest/. Free in B2."""
    for name in filenames:
        ctx.storage.copy(
            _backup_key_for(ctx.home_id, ctx.today, name),
            _latest_key_for(ctx.home_id, name),
        )


# ---------- relay status report ----------

def _report_status_to_relay(ctx: BackupContext, result: dict) -> None:
    """POST the run outcome to the relay's backup-status endpoint.

    Mirrors services/ota_client.py's signing pattern: serialize the body
    once, sign those exact bytes with the per-home relay_secret, send the
    same bytes with the X-Ziggy-Signature header.

    Dev hubs without relay creds (relay_url or relay_secret missing) are
    silently skipped. A dry-run is reported with dry_run=true so the
    founder can tell apart a real upload from a simulated one.

    Body shape matches relay/app/routers/backup_keys.py::report_backup_status
    which accepts a free-form JSON object. We send:
      outcome           "success" | "failure" | "skipped"
      stage             last stage reached (preflight/zha/.../done/lock)
      uploaded_bytes    bytes successfully pushed to B2 this run
      files             list of bundle filenames in the manifest
      optional_skipped  list of bundles deliberately omitted (e.g. oversized recorder.db)
      ha_version        HA version at backup time (informational)
      ziggy_version     hub version at backup time (informational)
      error_reason      short error tag if outcome=="failure"; null otherwise
      skipped_reason    why we skipped (e.g. subscription_gated); null otherwise
      dry_run           true iff this was a dry-run (no real upload)
    """
    if not ctx.relay_url or not ctx.relay_secret:
        log.debug("relay creds missing; skipping backup-status POST")
        return

    if result.get("ok"):
        outcome = "success"
    elif result.get("skipped_reason"):
        outcome = "skipped"
    else:
        outcome = "failure"

    payload = {
        "outcome": outcome,
        "stage": result.get("stage"),
        "uploaded_bytes": result.get("uploaded_bytes", 0),
        "files": result.get("files", []),
        "optional_skipped": result.get("optional_skipped", []),
        "ha_version": ctx.ha_version,
        "ziggy_version": ctx.ziggy_version,
        "error_reason": result.get("error"),
        "skipped_reason": result.get("skipped_reason"),
        "dry_run": bool(ctx.dry_run),
    }
    # Serialize once; sign the exact bytes we send so the relay's HMAC
    # verify (which hashes the raw request body) matches deterministically.
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    sig = sign_relay_signature(ctx.relay_secret, body)
    url = ctx.relay_url.rstrip("/") + f"/api/homes/{ctx.home_id}/backup-status"
    headers = {
        "X-Ziggy-Signature": sig,
        "Content-Type": "application/json",
    }
    poster = ctx._relay_post or _real_relay_post
    status = poster(url, headers, body, 15.0)
    if not (200 <= status < 300):
        # Caller's try/except will log this as a warning; we raise so the
        # outer wrapper records the actual HTTP code in the log line.
        raise RuntimeError(f"relay returned HTTP {status} from backup-status")
    log.info("backup-status reported to relay: outcome=%s home=%s",
             outcome, ctx.home_id)


def _real_relay_post(url: str, headers: dict, body: bytes, timeout: float) -> int:
    """Default transport for _report_status_to_relay. Returns HTTP status."""
    resp = requests.post(url, headers=headers, data=body, timeout=timeout)
    return resp.status_code


# ---------- file lock with stale-PID cleanup ----------
#
# Chunk #5 impl flag (DESIGN_BACKUP_DR.md §13): on lock acquisition,
# read the PID stored in the lockfile; if that process is dead, clear
# the lock and proceed. Without this, a crashed prior run would leave
# the lock pinned forever and every subsequent day would skip.

def _pid_alive(pid: int) -> bool:
    """True iff a process with the given PID exists.

    Uses signal 0 — "check only, don't deliver." ProcessLookupError means
    the PID is gone. PermissionError means the process exists but is
    owned by another user; we treat that as alive (don't wrongly clear
    someone else's lock).
    """
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def _acquire_backup_lock(path: str) -> Optional[int]:
    """Acquire an exclusive flock on `path`. Returns the fd to release later.

    Stale-PID cleanup happens before the flock attempt: if the lockfile
    holds a dead PID, we unlink it. If another live process holds the
    lock, raises RuntimeError. On non-POSIX (no fcntl), returns None —
    locking is silently skipped.
    """
    if not _HAS_FCNTL:
        log.warning("fcntl unavailable — backup lock not enforced on this platform")
        return None

    # Stale-lock cleanup. Best-effort: if anything in here fails, we let
    # flock decide the truth.
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                content = f.read().strip()
            if content:
                try:
                    pid = int(content)
                except ValueError:
                    log.warning("lockfile %s has non-numeric contents — clearing", path)
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
                else:
                    if not _pid_alive(pid):
                        log.warning("clearing stale backup lock for dead PID %d", pid)
                        try:
                            os.unlink(path)
                        except OSError:
                            pass
        except OSError:
            pass

    # Ensure parent dir exists (e.g. /var/run/ziggy/ on first run).
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        try:
            os.makedirs(parent, exist_ok=True)
        except (PermissionError, OSError) as e:
            raise RuntimeError(f"cannot create lock directory {parent}: {e}") from e

    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        _fcntl.flock(fd, _fcntl.LOCK_EX | _fcntl.LOCK_NB)
    except (BlockingIOError, OSError) as e:
        os.close(fd)
        raise RuntimeError(f"backup already running (lock held at {path})") from e

    # Persist our PID for future stale-detection runs.
    try:
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        os.fsync(fd)
    except OSError as e:
        log.warning("could not write PID to lockfile %s: %s", path, e)

    return fd


def _release_backup_lock(fd: Optional[int], path: str) -> None:
    """Inverse of _acquire_backup_lock. Idempotent — safe to call twice."""
    if fd is None:
        return
    try:
        _fcntl.flock(fd, _fcntl.LOCK_UN)
    except OSError:
        pass
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.unlink(path)
    except (FileNotFoundError, OSError):
        pass


def run_daily_backup_with_lock(ctx: BackupContext) -> dict:
    """Acquire the per-hub backup lock, run one daily cycle, release.

    On lock contention, returns a result dict (stage="lock") rather than
    raising — uniform with run_daily_backup's exception-to-dict contract
    so the scheduler can handle every outcome the same way.
    """
    try:
        fd = _acquire_backup_lock(ctx.lock_path)
    except RuntimeError as e:
        log.warning("backup lock unavailable: %s", e)
        return {
            "ok": False,
            "stage": "lock",
            "uploaded_bytes": 0,
            "files": [],
            "optional_skipped": [],
            "error": str(e),
        }
    try:
        return run_daily_backup(ctx)
    finally:
        _release_backup_lock(fd, ctx.lock_path)


# ---------- runtime factory (settings + env + kit manifest) ----------

def _read_kit_manifest(path: str) -> dict:
    """Read the factory-imaging kit manifest. Returns {} if missing.

    The factory imaging script (per docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md,
    Chunk #10) writes this file at provisioning time. Until that script
    lands, callers fall back to settings.backup.{device_id, coordinator_type}.
    """
    p = Path(path)
    if not p.is_file():
        return {}
    try:
        import yaml
        data = yaml.safe_load(p.read_text()) or {}
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log.warning("kit manifest at %s unreadable: %s", path, e)
        return {}


def _load_data_key(path: str) -> bytes:
    """Read raw 32-byte data_key from disk. Strict on length.

    File format is binary — exactly 32 random bytes written by the
    factory imaging script with `head -c 32 /dev/urandom > <path>`.
    Mode 0600. Lives outside the backup bundle by design.
    """
    try:
        raw = Path(path).read_bytes()
    except FileNotFoundError as e:
        raise RuntimeError(f"data_key not found at {path} — seal-key step missing") from e
    except PermissionError as e:
        raise RuntimeError(f"data_key at {path} unreadable (check mode 0600 and uid): {e}") from e
    if len(raw) != 32:
        raise RuntimeError(
            f"data_key at {path} must be exactly 32 bytes, got {len(raw)}. "
            "Regenerate with `head -c 32 /dev/urandom > <path>`."
        )
    return raw


def _build_context_from_settings(
    settings: Optional[dict],
    *,
    dry_run: bool,
    today: Optional[dt.date],
) -> BackupContext:
    """Shared factory body for BackupContext.from_settings(); separated so
    tests can patch settings without monkey-patching the global loader."""
    if settings is None:
        from core.settings_loader import settings as global_settings
        settings = global_settings
    backup_cfg = (settings or {}).get("backup") or {}
    home_cfg = (settings or {}).get("home") or {}
    ha_cfg = (settings or {}).get("home_assistant") or {}
    relay_cfg = (settings or {}).get("relay") or {}

    home_id = home_cfg.get("id")
    if not home_id:
        raise RuntimeError("settings.home.id must be set to back up")

    # Kit manifest wins over settings fallbacks.
    kit_path = backup_cfg.get("kit_manifest_path", "/etc/ziggy/kit_manifest.yaml")
    kit = _read_kit_manifest(kit_path)
    device_id = kit.get("device_id") or backup_cfg.get("device_id")
    coordinator_type = kit.get("coordinator_type") or backup_cfg.get("coordinator_type", "smlight")
    coordinator_ieee = kit.get("coordinator_ieee")

    if not device_id or device_id == "REPLACE_WITH_DEVICE_ID":
        raise RuntimeError(
            "device_id missing: factory imaging script must populate "
            f"{kit_path} (see docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md) "
            "or set settings.backup.device_id for dev."
        )
    if coordinator_type not in ("smlight", "sonoff_e"):
        raise RuntimeError(
            f"coordinator_type {coordinator_type!r} not recognized; expected "
            "'smlight' or 'sonoff_e' per DESIGN_BACKUP_DR.md §8."
        )

    data_key_path = backup_cfg.get("data_key_path", "/etc/ziggy/data_key")
    data_key = _load_data_key(data_key_path)

    ha_url = ha_cfg.get("url")
    ha_token = ha_cfg.get("token")
    if not ha_url or not ha_token:
        raise RuntimeError("settings.home_assistant.url and .token must be set")

    storage = BackupStorage.from_settings(settings)

    return BackupContext(
        home_id=home_id,
        device_id=device_id,
        coordinator_type=coordinator_type,
        coordinator_ieee=coordinator_ieee,
        data_key=data_key,
        ha_config_dir=Path(backup_cfg.get("ha_config_dir", "docker/ha-config")),
        z2m_data_dir=Path(backup_cfg.get("z2m_data_dir", "docker/z2m-data")),
        user_files_dir=Path(backup_cfg.get("user_files_dir", "user_files")),
        config_dir=Path(backup_cfg.get("config_dir", "config")),
        storage=storage,
        ha_url=ha_url,
        ha_token=ha_token,
        recorder_skip_threshold_mb=int(backup_cfg.get("recorder_skip_threshold_mb", 500)),
        lock_path=backup_cfg.get("lock_path", DEFAULT_LOCK_PATH),
        dry_run=dry_run,
        today=today or dt.date.today(),
        relay_url=relay_cfg.get("url"),
        relay_secret=relay_cfg.get("secret"),
    )


# Attach as a classmethod after definition to avoid forward-reference juggling
# inside the @dataclass body above.
def _from_settings(cls, settings: Optional[dict] = None, *, dry_run: bool = False,
                   today: Optional[dt.date] = None) -> "BackupContext":
    """Build a BackupContext from settings.yaml, env vars, and on-disk
    key/kit-manifest material.

    Production callers (scheduler, CLI) call this with no args — it reads
    the global settings loader. Tests pass an explicit settings dict.
    """
    return _build_context_from_settings(settings, dry_run=dry_run, today=today)


BackupContext.from_settings = classmethod(_from_settings)  # type: ignore[attr-defined]


# ---------- CLI: python -m services.backup_engine --once ----------

def _main(argv: Optional[list[str]] = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(
        prog="python -m services.backup_engine",
        description="Manually trigger one daily backup run on this hub.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single backup now and exit. Required (no other modes yet).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Collect + encrypt + manifest, but skip the B2 upload + relay POST.",
    )
    args = parser.parse_args(argv)
    if not args.once:
        parser.error("--once is required (use --help for available modes).")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    ctx = BackupContext.from_settings(dry_run=args.dry_run)
    result = run_daily_backup_with_lock(ctx)
    print(json.dumps(result, indent=2, default=str))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(_main())
