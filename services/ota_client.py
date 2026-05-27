"""Edge OTA client — hourly poll of the relay's manifest endpoint.

Prompt 2 §B, chunk 2.2. Companion to relay/app/routers/ota.py.

Scope of this module:

  poll_once()                  fetch + verify + delta-detect + persist
  load_state()                 read user_files/ota_state.json
  save_state()                 write user_files/ota_state.json
  mark_installed(manifest)     promoted by the actual installer (Prompt 4)

What this module does NOT do:

  - Download container images / HA versions. That's the install step,
    which lives in Prompt 4 for HA pinning and is out of scope for the
    Ziggy self-update story until later.
  - Apply or roll back updates. The installer (Prompt 4) reads the
    staged manifest from disk, runs its own apply path, and on success
    calls mark_installed() here to clear the stage.

State file (user_files/ota_state.json):

    {
      "installed":    <manifest or null>,
      "staged":       <manifest or null>,
      "last_poll_ts": "<iso8601 or null>",
      "last_error":   "<reason or null>"
    }

The "staged" field holds the most recently fetched manifest when it
differs from "installed". A subsequent poll that returns the same
versions does NOT re-stage — the staged field is sticky until the
installer clears it.

Config inputs (all from core.settings_loader.settings):

    settings.home.id            home_id, used in URL as device_id (v1 equivalence)
    settings.relay.url          relay base URL (no trailing /api)
    settings.relay.secret       per-home relay_secret (X-Ziggy-Signature)
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests

from core.relay_signing import sign as sign_signature

log = logging.getLogger(__name__)

# Public so tests and Prompt 4's installer can import the same path.
OTA_STATE_PATH = Path("user_files/ota_state.json")

# Inner manifest signature must verify with the same per-home secret the
# transport HMAC uses. See relay/app/routers/ota.py for the canonical
# JSON encoding rules — both sides must encode identically or the
# signature won't match.
import hashlib
import hmac
import time


# ---------------------------------------------------------------------------
# State file I/O
# ---------------------------------------------------------------------------

_DEFAULT_STATE: dict = {
    "installed":    None,
    "staged":       None,
    "last_poll_ts": None,
    "last_error":   None,
}


def load_state(path: Path = OTA_STATE_PATH) -> dict:
    """Read the state file. Missing file → fresh defaults. Malformed → log + defaults."""
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return dict(_DEFAULT_STATE)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("ota_state.json malformed (%s) — resetting", e)
        return dict(_DEFAULT_STATE)
    if not isinstance(data, dict):
        return dict(_DEFAULT_STATE)
    out = dict(_DEFAULT_STATE)
    out.update({k: data.get(k) for k in _DEFAULT_STATE.keys()})
    return out


def save_state(state: dict, path: Path = OTA_STATE_PATH) -> None:
    """Atomic write — temp file + rename so a crash mid-write doesn't truncate."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    os.replace(tmp, path)


def mark_installed(manifest: dict, path: Path = OTA_STATE_PATH) -> None:
    """Promote a manifest from staged → installed. Called by the installer (Prompt 4)
    after a successful apply. Clears the staged field.

    No-op if the input doesn't look like a manifest (missing release_id).
    """
    if not isinstance(manifest, dict) or "release_id" not in manifest:
        log.warning("mark_installed called with invalid manifest; ignoring")
        return
    state = load_state(path)
    state["installed"] = manifest
    state["staged"] = None
    save_state(state, path)


# ---------------------------------------------------------------------------
# Manifest signature verification
# ---------------------------------------------------------------------------

def _canonical_bytes_for_signing(manifest_no_sig: dict) -> bytes:
    """MUST match relay/app/routers/ota.py::_canonical_bytes_for_signing.

    Both sides encode the manifest with sort_keys=True and tight separators.
    Drift here means signatures silently fail to verify.
    """
    return json.dumps(manifest_no_sig, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _verify_manifest_signature(manifest: dict, secret: str) -> tuple[bool, str]:
    """Returns (ok, reason). Same wire format as audit.verify on the relay."""
    sig = manifest.get("signature", "")
    if not isinstance(sig, str) or "," not in sig or "t=" not in sig or "v1=" not in sig:
        return False, "missing_or_malformed_signature"
    ts: Optional[int] = None
    v1: Optional[str] = None
    for piece in sig.split(","):
        piece = piece.strip()
        if piece.startswith("t="):
            try:
                ts = int(piece[2:])
            except ValueError:
                return False, "missing_or_malformed_signature"
        elif piece.startswith("v1="):
            v1 = piece[3:].strip()
    if ts is None or v1 is None:
        return False, "missing_or_malformed_signature"
    # 5-minute window matches relay/app/audit.py::SIGNATURE_WINDOW_S. A
    # staged manifest verified out-of-window means it sat on disk too
    # long; the installer should refetch rather than apply stale.
    if abs(int(time.time()) - ts) > 300:
        return False, "timestamp_outside_window"

    body = {k: v for k, v in manifest.items() if k != "signature"}
    payload = f"{ts}.".encode("utf-8") + _canonical_bytes_for_signing(body)
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1):
        return False, "signature_mismatch"
    return True, ""


# ---------------------------------------------------------------------------
# Delta detection
# ---------------------------------------------------------------------------

def _has_delta(installed: Optional[dict], fetched: dict) -> bool:
    """True if the fetched manifest names a different version than installed.

    First poll on a fresh hub (installed=None) always reports a delta —
    that's correct: the hub needs to know its target before it can
    converge to it, even if it can't apply yet.
    """
    if not installed:
        return True
    for key in ("ha_version", "ziggy_version"):
        if installed.get(key) != fetched.get(key):
            return True
    if (installed.get("image_digests") or {}) != (fetched.get("image_digests") or {}):
        return True
    return False


# ---------------------------------------------------------------------------
# Poll
# ---------------------------------------------------------------------------

class OtaPollResult(dict):
    """Plain dict with a stable shape so callers can inspect outcomes.

    Keys:
      ok          bool — fetched + verified successfully (delta may or may not exist)
      reason      str  — short outcome label (delta_staged / no_delta / <error>)
      manifest    dict | None — what the relay returned, if any
      staged      bool — True if a delta was detected and persisted this run
    """


def _build_url(relay_url: str, home_id: str) -> str:
    """Hit the relay's OTA endpoint. v1 hardcodes device_id = home_id."""
    return f"{relay_url.rstrip('/')}/api/devices/{home_id}/ota-manifest"


def poll_once(
    *,
    settings: Optional[dict] = None,
    state_path: Path = OTA_STATE_PATH,
    timeout_s: float = 15.0,
    _now: Optional[Any] = None,
    _http_get: Optional[Any] = None,
) -> OtaPollResult:
    """Single poll cycle. Returns a result dict; never raises.

    Test seams:
      _now       — callable() -> datetime, defaults to datetime.now(timezone.utc)
      _http_get  — callable(url, headers, timeout) -> response-like with
                   .status_code, .text, .json(); defaults to requests.get
    """
    now_fn = _now or (lambda: datetime.now(timezone.utc))
    get_fn = _http_get or _real_http_get
    state = load_state(state_path)

    try:
        if settings is None:
            from core.settings_loader import settings as global_settings
            settings = global_settings
        home_id = (settings.get("home") or {}).get("id")
        relay_cfg = settings.get("relay") or {}
        relay_url = relay_cfg.get("url")
        secret = relay_cfg.get("secret")

        if not home_id or not relay_url or not secret:
            return _record_failure(
                state, state_path, now_fn,
                reason="missing_config",
                detail=f"home.id={bool(home_id)} relay.url={bool(relay_url)} relay.secret={bool(secret)}",
            )

        url = _build_url(relay_url, home_id)
        sig = sign_signature(secret, b"")
        headers = {"X-Ziggy-Signature": sig, "Accept": "application/json"}

        try:
            resp = get_fn(url, headers=headers, timeout=timeout_s)
        except Exception as e:
            return _record_failure(
                state, state_path, now_fn,
                reason="network_error", detail=f"{type(e).__name__}: {e}",
            )

        if resp.status_code == 404:
            return _record_failure(
                state, state_path, now_fn, reason="no_release_or_unknown_home",
                detail=f"http_{resp.status_code}",
            )
        if resp.status_code == 403:
            return _record_failure(
                state, state_path, now_fn, reason="suspended",
                detail=f"http_{resp.status_code}",
            )
        if resp.status_code != 200:
            return _record_failure(
                state, state_path, now_fn, reason="http_error",
                detail=f"http_{resp.status_code}: {resp.text[:200]}",
            )

        try:
            manifest = resp.json()
        except Exception as e:
            return _record_failure(
                state, state_path, now_fn, reason="malformed_response",
                detail=f"{type(e).__name__}: {e}",
            )
        if not isinstance(manifest, dict):
            return _record_failure(
                state, state_path, now_fn, reason="malformed_response",
                detail="not_an_object",
            )

        ok, why = _verify_manifest_signature(manifest, secret)
        if not ok:
            return _record_failure(
                state, state_path, now_fn, reason="bad_signature", detail=why,
            )

        delta = _has_delta(state.get("installed"), manifest)
        state["last_poll_ts"] = now_fn().isoformat()
        state["last_error"] = None
        if delta:
            state["staged"] = manifest
            save_state(state, state_path)
            log.info("OTA delta staged: release_id=%s ha=%s ziggy=%s",
                     manifest.get("release_id"), manifest.get("ha_version"),
                     manifest.get("ziggy_version"))
            return OtaPollResult(ok=True, reason="delta_staged",
                                 manifest=manifest, staged=True)
        save_state(state, state_path)
        return OtaPollResult(ok=True, reason="no_delta",
                             manifest=manifest, staged=False)
    except Exception as e:
        # Defense-in-depth — poll_once must never raise into the scheduler.
        return _record_failure(
            state, state_path, now_fn, reason="unexpected_error",
            detail=f"{type(e).__name__}: {e}",
        )


def _record_failure(state: dict, path: Path, now_fn, *, reason: str, detail: str) -> OtaPollResult:
    state["last_poll_ts"] = now_fn().isoformat()
    state["last_error"] = f"{reason}: {detail}"
    try:
        save_state(state, path)
    except OSError as e:
        log.warning("ota_state.json save failed: %s", e)
    log.warning("OTA poll failure: %s — %s", reason, detail)
    return OtaPollResult(ok=False, reason=reason, manifest=None, staged=False)


def _real_http_get(url: str, *, headers: dict, timeout: float):
    return requests.get(url, headers=headers, timeout=timeout)
